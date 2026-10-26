import { specSchema, type AppSpec } from '../spec/schema';
import { summarizeIssues, validateSpec, type Issue } from '../spec/validate';
import { getProvider } from './provider';

export type GenEvent =
  | { t: 'step'; id: string; label: string; status: 'running' | 'done' | 'failed'; detail?: string }
  | { t: 'text'; text: string }
  | { t: 'issue'; attempt: number; issues: Issue[] }
  | { t: 'done'; spec: AppSpec; attempts: number; model: string; fallbackNote?: string }
  | { t: 'error'; message: string; issues?: Issue[] };

const MAX_ATTEMPTS = 3;

/** 需求里出现这类措辞，说明用户要的是「下限」而不是普通字段描述（缺陷 3） */
const CONSTRAINT_RE = /大于\s*0|不能为\s*0|必须为正|至少\s*1|不为\s*0/;
const MONEY_LABEL_RE = /金额|费用|价格|成本|工资/;
const COUNT_LABEL_RE = /数量|件数|人数|次数/;

/**
 * 把自然语言约束确定性地落成字段的 min。
 *
 * 为什么不能只靠提示词：模型会漏掉「min」这类不出现在页面上、看起来不重要的属性，
 * 而漏掉一次就意味着 0 元记录能被写进数据库。这里在 zod 校验通过后兜一层，
 * 提示词负责"尽量对"，这里负责"一定对"。
 */
export function applyConstraintHints(
  spec: AppSpec,
  rawPrompt: string,
): { spec: AppSpec; changed: string[] } {
  if (!CONSTRAINT_RE.test(rawPrompt)) return { spec, changed: [] };

  const next = JSON.parse(JSON.stringify(spec)) as AppSpec;
  const changed: string[] = [];

  for (const entity of next.entities) {
    for (const field of entity.fields) {
      if (field.type !== 'number' || field.min !== undefined) continue;
      if (MONEY_LABEL_RE.test(field.label)) {
        field.min = 0.01;
        changed.push(`${field.label} ≥ 0.01`);
      } else if (COUNT_LABEL_RE.test(field.label)) {
        field.min = 1;
        changed.push(`${field.label} ≥ 1`);
      }
    }
  }

  return { spec: next, changed };
}

function zodToIssues(error: unknown): Issue[] {
  const anyErr = error as { issues?: Array<{ path: (string | number)[]; message: string; code?: string }> };
  return (anyErr.issues ?? []).slice(0, 8).map((i) => ({
    code: i.code?.toUpperCase() ?? 'SCHEMA',
    path: i.path.join('.') || 'root',
    message: i.message,
  }));
}

export async function generateSpec(input: {
  prompt: string;
  csv?: string | null;
  emit: (e: GenEvent) => void;
}): Promise<{ spec: AppSpec; attempts: number; model: string; fallbackNote?: string }> {
  const { prompt, csv, emit } = input;
  const provider = getProvider();
  let feedback: string | undefined;

  emit({ t: 'step', id: 'plan', label: '理解需求并规划结构', status: 'running' });
  emit({
    t: 'text',
    text: csv?.trim()
      ? '检测到表格输入，先按表头推断字段与类型，再规划页面。'
      : `收到需求：「${prompt.slice(0, 40)}」，先确定要记录的对象和字段。`,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      emit({ t: 'step', id: 'plan', label: '理解需求并规划结构', status: 'done', detail: '实体与字段已确定' });
    }
    emit({ t: 'step', id: 'build', label: '生成应用声明（AppSpec）', status: 'running' });
    const started = Date.now();

    let raw: unknown;
    let model = provider.name;
    let fallbackNote: string | undefined;
    try {
      const out = await provider.generate({ prompt, csv, feedback });
      raw = out.spec;
      model = out.model;
      fallbackNote = out.fallbackNote;
      if (fallbackNote) emit({ t: 'text', text: fallbackNote });
    } catch (err) {
      emit({ t: 'step', id: 'build', label: '生成应用声明（AppSpec）', status: 'failed', detail: (err as Error).message });
      if (attempt === MAX_ATTEMPTS) {
        const message = `生成失败：${(err as Error).message}`;
        emit({ t: 'error', message });
        throw new Error(message);
      }
      feedback = `调用失败：${(err as Error).message}`;
      continue;
    }

    emit({ t: 'step', id: 'build', label: '生成应用声明（AppSpec）', status: 'done', detail: `耗时 ${Date.now() - started}ms` });

    emit({ t: 'step', id: 'critic', label: '校验结构完整性', status: 'running' });
    const parsed = specSchema.safeParse(raw);
    let issues: Issue[] = [];
    let spec: AppSpec | null = null;
    if (!parsed.success) {
      issues = zodToIssues(parsed.error);
    } else {
      spec = parsed.data;
      // 提示词之外再兜一层：把「金额大于 0」这类约束确定性落到字段 min 上
      const hinted = applyConstraintHints(spec, prompt);
      if (hinted.changed.length > 0) {
        spec = hinted.spec;
        emit({ t: 'text', text: `按需求补充了字段下限约束：${hinted.changed.join('、')}` });
      }
      issues = validateSpec(spec);
    }

    if (issues.length === 0 && spec) {
      emit({ t: 'step', id: 'critic', label: '校验结构完整性', status: 'done', detail: '全部通过' });
      emit({ t: 'done', spec, attempts: attempt, model, fallbackNote });
      return { spec, attempts: attempt, model, fallbackNote };
    }

    emit({ t: 'step', id: 'critic', label: '校验结构完整性', status: 'failed', detail: `${issues.length} 个问题` });
    emit({ t: 'issue', attempt, issues });

    if (attempt === MAX_ATTEMPTS) {
      const message = `三次生成均未通过校验，最后一次问题：\n${summarizeIssues(issues)}`;
      emit({ t: 'error', message, issues });
      throw new Error(message);
    }
    feedback = summarizeIssues(issues);
    emit({ t: 'text', text: `第 ${attempt} 次输出有 ${issues.length} 处问题，带错误回灌重试。` });
  }

  throw new Error('unreachable');
}
