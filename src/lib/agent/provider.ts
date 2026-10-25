import { specFromCsv, specFromPrompt } from './templates';
import { SCHEMA_BRIEF } from './prompts';

export type GenerateInput = {
  prompt: string;
  csv?: string | null;
  feedback?: string;
};

export type GenerateOutput = {
  spec: unknown;
  model: string;
  fallbackNote?: string;
};

export interface LlmProvider {
  name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 默认通道：本地确定性生成，无需 API key，保证"克隆下来就能跑" */
export const mockProvider: LlmProvider = {
  name: 'mock',
  async generate({ prompt, csv }) {
    await sleep(500);
    if (csv && csv.trim().length > 0) {
      const inferred = specFromCsv(csv, prompt);
      if (inferred) return { spec: inferred, model: 'mock:csv-infer' };
    }
    const { spec } = specFromPrompt(prompt);
    return { spec, model: 'mock:template' };
  },
};

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return body.trim();
  return body.slice(start, end + 1);
}

/** 真实通道：任意 OpenAI 兼容端点（DeepSeek / 通义 / vLLM 均可） */
export const openaiProvider: LlmProvider = {
  name: 'openai',
  async generate({ prompt, csv, feedback }) {
    const base = (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/$/, '');
    const model = process.env.LLM_MODEL ?? 'deepseek-chat';
    const key = process.env.LLM_API_KEY;
    if (!key) throw new Error('LLM_API_KEY 未配置');

    const userParts = [`业务需求：${prompt}`];
    if (csv && csv.trim()) {
      userParts.push(`用户上传的表格（CSV，仅前 40 行）：\n${csv.split(/\r?\n/).slice(0, 40).join('\n')}`);
      userParts.push('请以表格表头作为字段来源，字段数量不要超过 8 个。');
    }
    if (feedback) userParts.push(`上一次输出未通过校验，问题如下，请修正后重新输出完整 JSON：\n${feedback}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SCHEMA_BRIEF },
            { role: 'user', content: userParts.join('\n\n') },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`模型调用失败 ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('模型返回为空');
      return { spec: JSON.parse(stripFence(content)), model: `${model}` };
    } finally {
      clearTimeout(timeout);
    }
  },
};

/** 真实通道失败时降级到模板，并在结果里标注原因——宁可降级也不白屏，但不隐瞒 */
function withFallback(primary: LlmProvider, fallback: LlmProvider): LlmProvider {
  return {
    name: `${primary.name}+fallback`,
    async generate(input) {
      try {
        return await primary.generate(input);
      } catch (err) {
        const out = await fallback.generate(input);
        return {
          ...out,
          model: `${fallback.name}(降级)`,
          fallbackNote: `真实模型调用失败，已降级为模板生成：${(err as Error).message.slice(0, 120)}`,
        };
      }
    },
  };
}

export function getProvider(): LlmProvider {
  const mode = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (mode === 'openai' && process.env.LLM_API_KEY) {
    return withFallback(openaiProvider, mockProvider);
  }
  return mockProvider;
}
