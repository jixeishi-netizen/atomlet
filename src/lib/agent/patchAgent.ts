import type { AppSpec, Entity, Field } from '../spec/schema';
import type { PatchOp } from '../patch';

export type PatchRequest = {
  spec: AppSpec;
  instruction: string;
  history?: string[];
};

export type PatchOutput = {
  patch: PatchOp[];
  degraded: boolean;
  note?: string;
  model: string;
  fallbackNote?: string;
};

const FIELD_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function pickEntity(spec: AppSpec): { entity: Entity; index: number } {
  return { entity: spec.entities[0], index: 0 };
}

/** 模糊匹配：指令里的「区域」应该能命中字段「所属区域」（按最长公共子串打分） */
function findFieldIndex(entity: Entity, text: string): number {
  let best = -1;
  let bestScore = 0;
  entity.fields.forEach((f, i) => {
    let score = 0;
    if (text.includes(f.label)) score = 10;
    else if (new RegExp(`\\b${f.key}\\b`, 'i').test(text)) score = 8;
    else {
      for (let len = Math.min(f.label.length, 4); len >= 2 && score === 0; len--) {
        for (let s = 0; s + len <= f.label.length; s++) {
          if (text.includes(f.label.slice(s, s + len))) {
            score = len;
            break;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function findPageIndex(spec: AppSpec, type: string): number {
  return spec.pages.findIndex((p) => p.type === type);
}

function guessType(label: string): Field['type'] {
  if (/金额|费用|价格|成本|数量|得分|分数/.test(label)) return 'number';
  if (/日期|时间/.test(label)) return 'date';
  if (/是否|与否/.test(label)) return 'bool';
  if (/备注|说明|描述|原因/.test(label)) return 'longtext';
  return 'text';
}

function extractNewFieldLabel(instruction: string): string | null {
  const patterns = [
    /字段[：:是为]?\s*[「"']([^」"']{1,12})[」"']/,
    /(?:加|新增|添加|增加)[^，。]{0,12}?字段[：:\s]*[「"']?([^「」"'\s，。]{1,12})/,
    /(?:加|新增|添加|增加)[^，。]{0,6}?[「"']([^」"']{1,12})[」"']/,
  ];
  for (const re of patterns) {
    const m = instruction.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/** mock 通道：规则匹配意图，输出确定性 patch（无需 API key，但同样要过白名单与校验） */
export function mockPatch(req: PatchRequest): PatchOutput {
  const { spec, instruction } = req;
  // 交互式应用没有实体，规则通道无法改游戏逻辑，如实降级而不是报错
  if (spec.entities.length === 0) {
    return {
      patch: [],
      degraded: true,
      note: '这是交互式应用（内置游戏引擎），暂不支持用一句话修改玩法；可以改标题或主题',
      model: 'mock:rule',
    };
  }
  const { entity, index: entityIndex } = pickEntity(spec);
  const ops: PatchOp[] = [];
  const addIntent = /(加|新增|添加|增加)/.test(instruction);

  // 1) 新增字段（同时补到列表页，否则用户看不到）
  if (addIntent && /字段/.test(instruction)) {
    const label = extractNewFieldLabel(instruction) ?? '补充信息';
    let key = `extra${entity.fields.length + 1}`;
    while (!FIELD_KEY_RE.test(key) || entity.fields.some((f) => f.key === key)) {
      key = `extra${Number(key.replace(/\D/g, '')) + 1}`;
    }
    const field: Field = { key, label, type: guessType(label), required: false };
    ops.push({ op: 'add', path: `/entities/${entityIndex}/fields/-`, value: field });

    const tableIdx = findPageIndex(spec, 'table');
    if (tableIdx >= 0) {
      ops.push({ op: 'add', path: `/pages/${tableIdx}/columns/-`, value: { field: key } });
    }
    return { patch: ops, degraded: false, note: `新增字段「${label}」，并加入列表列`, model: 'mock:rule' };
  }

  // 2) 列表加列（引用已有字段）
  if (addIntent && /(列|column)/.test(instruction)) {
    const fieldIdx = findFieldIndex(entity, instruction);
    const tableIdx = findPageIndex(spec, 'table');
    if (fieldIdx >= 0 && tableIdx >= 0) {
      ops.push({
        op: 'add',
        path: `/pages/${tableIdx}/columns/-`,
        value: { field: entity.fields[fieldIdx].key },
      });
      return {
        patch: ops,
        degraded: false,
        note: `列表新增「${entity.fields[fieldIdx].label}」列`,
        model: 'mock:rule',
      };
    }
  }

  // 3) 加统计卡
  if (addIntent && /(卡片|指标|统计|看板)/.test(instruction)) {
    const statsIdx = findPageIndex(spec, 'stats');
    const page = statsIdx >= 0 ? spec.pages[statsIdx] : null;
    if (page && page.type === 'stats') {
      const numericIdx = entity.fields.findIndex((f) => f.type === 'number');
      const mentionedIdx = findFieldIndex(entity, instruction);
      const isAvg = /平均|均值/.test(instruction);
      const isSum = /合计|总额|总和|总计/.test(instruction);
      let fn: 'count' | 'avg' | 'sum' = isAvg ? 'avg' : isSum ? 'sum' : 'count';
      let fieldKey: string | undefined;

      if (fn !== 'count') {
        const chosen =
          mentionedIdx >= 0 && entity.fields[mentionedIdx].type === 'number'
            ? entity.fields[mentionedIdx]
            : numericIdx >= 0
              ? entity.fields[numericIdx]
              : undefined;
        if (!chosen) {
          fn = 'count';
        } else {
          fieldKey = chosen.key;
        }
      }

      const label = (() => {
        if (fn === 'count') return '记录总数';
        const fieldLabel = entity.fields.find((f) => f.key === fieldKey)?.label ?? '';
        return fn === 'avg' ? `平均${fieldLabel}` : `${fieldLabel}合计`;
      })();

      const duplicated = page.cards.some(
        (c) => c.label === label || (c.fn === fn && (c.field ?? '') === (fieldKey ?? '')),
      );
      if (duplicated) {
        return {
          patch: [],
          degraded: true,
          note: `「${label}」这张卡片已经存在了，换个指标试试`,
          model: 'mock:rule',
        };
      }

      ops.push({
        op: 'add',
        path: `/pages/${statsIdx}/cards/-`,
        value: { label, fn, ...(fieldKey ? { field: fieldKey } : {}) },
      });
      return { patch: ops, degraded: false, note: `新增卡片「${label}」`, model: 'mock:rule' };
    }
  }

  // 4) 删卡片
  if (/(删|去掉|移除|删除)/.test(instruction) && /(卡片|指标|统计)/.test(instruction)) {
    const statsIdx = findPageIndex(spec, 'stats');
    if (statsIdx >= 0) {
      const page = spec.pages[statsIdx];
      if (page.type === 'stats') {
        const cardIdx = page.cards.findIndex((c) => instruction.includes(c.label));
        if (cardIdx >= 0 && page.cards.length > 1) {
          ops.push({ op: 'remove', path: `/pages/${statsIdx}/cards/${cardIdx}` });
          return { patch: ops, degraded: false, note: `移除「${page.cards[cardIdx].label}」卡片`, model: 'mock:rule' };
        }
      }
    }
  }

  // 5) 改必填
  if (/必填|必需要填|不能为空/.test(instruction)) {
    const fieldIdx = findFieldIndex(entity, instruction);
    if (fieldIdx >= 0) {
      ops.push({
        op: 'replace',
        path: `/entities/${entityIndex}/fields/${fieldIdx}/required`,
        value: true,
      });
      return {
        patch: ops,
        degraded: false,
        note: `「${entity.fields[fieldIdx].label}」改为必填`,
        model: 'mock:rule',
      };
    }
  }

  // 6) 改应用名
  if (/(改名|名称|应用名|标题)/.test(instruction)) {
    const m = instruction.match(/(?:改成|改为|叫)\s*[「"']?([^「」"'\s，。]{2,16})[」"']?/);
    if (m) {
      ops.push({ op: 'replace', path: '/app/name', value: m[1].trim() });
      return { patch: ops, degraded: false, note: `应用名改为「${m[1].trim()}」`, model: 'mock:rule' };
    }
  }

  // 7) 换主题
  if (/(主题|配色|颜色|色调)/.test(instruction)) {
    const theme = /暖/.test(instruction)
      ? 'warm'
      : /冷|蓝/.test(instruction)
        ? 'cool'
        : /中性|素|灰/.test(instruction)
          ? 'neutral'
          : null;
    if (theme) {
      ops.push({ op: 'replace', path: '/app/theme', value: theme });
      return { patch: ops, degraded: false, note: `主题切到 ${theme}`, model: 'mock:rule' };
    }
  }

  return {
    patch: [],
    degraded: true,
    note: '这句指令没匹配到可执行的修改。可以试试：「把得分改成必填」「加一个字段：整改负责人」「列表里加上区域列」「加一张平均分卡片」',
    model: 'mock:rule',
  };
}

const PATCH_SYSTEM_PROMPT = `你是 Atomlet 的修改助手。输入是当前 AppSpec（JSON）和一句修改指令，输出一组 JSON Patch。

只输出 JSON，格式：{"patch":[{"op":"add|replace|remove|move","path":"/...","value":...}]}

允许的取值（写错会被服务端拒绝）：
- app.theme ∈ "neutral" | "warm" | "cool"
- app.icon ∈ "clipboard-check" | "receipt" | "users" | "table" | "clipboard-list"
- field.type ∈ "text" | "longtext" | "number" | "date" | "enum" | "bool" | "url" | "ref" | "user"
- page.type ∈ "form" | "table" | "detail" | "stats" | "board" | "chart"
- cards[].fn ∈ "count" | "sum" | "avg" | "max" | "min"（除 count 外必须带 field，且该字段必须是 number 类型）
- columns[] / filters[] 的元素形状：{"field":"字段key","label":"可选"}

允许的路径（其余一律不要输出）：
/app/name | /app/theme | /app/description | /app/icon
/entities/{i}/fields/{j}/...      追加字段用 /entities/{i}/fields/-
/pages/{i}/...                    追加列/筛选/卡片用 /columns/- 、/filters/- 、/cards/-
/sharePolicy/mode

做法要求：
1. 先在 spec 里定位目标。用户说的字段名通常和 label 一致或接近（例如"处理状态"→ label "处理状态"），用它的精确下标构造 path。
2. 只改属性（必填、标签、枚举值等）用 replace；新增字段/列/卡片用 add 并在 value 里写完整对象。
3. 只要定位到了目标就必须输出补丁，不要因为格式细节不确定就返回空数组。
4. 确实与修改无关（闲聊、或要求的能力不存在）才返回 {"patch":[]}。
5. 不要修改 /specVersion，不要输出解释文字、不要 markdown 代码块。

示例：指令「把处理状态改成必填」，spec 里 entities[0].fields[5].label = "处理状态"
→ {"patch":[{"op":"replace","path":"/entities/0/fields/5/required","value":true}]}`;

export async function openaiPatch(req: PatchRequest): Promise<PatchOutput> {
  const base = (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL ?? 'deepseek-chat';
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY 未配置');

  const userParts = [
    `当前 AppSpec：\n${JSON.stringify(req.spec)}`,
    `修改指令：${req.instruction}`,
  ];
  if (req.history?.length) {
    userParts.push(`最近几轮改动（供参考，不要重复应用）：\n${req.history.slice(-3).join('\n')}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PATCH_SYSTEM_PROMPT },
          { role: 'user', content: userParts.join('\n\n') },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`模型调用失败 ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1) throw new Error('模型未返回 JSON');
    const parsed = JSON.parse(content.slice(start, end + 1)) as { patch?: PatchOp[] };
    const patch = Array.isArray(parsed.patch) ? parsed.patch : [];
    return {
      patch,
      degraded: patch.length === 0,
      note: patch.length === 0 ? '模型没有给出可执行的修改' : undefined,
      model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getPatchChannel(): 'mock' | 'openai' {
  const mode = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  return mode === 'openai' && process.env.LLM_API_KEY ? 'openai' : 'mock';
}

export async function buildPatch(req: PatchRequest): Promise<PatchOutput> {
  if (getPatchChannel() !== 'openai') return mockPatch(req);
  try {
    const out = await openaiPatch(req);
    // 模型空手时用规则兜底：宁可多一层，也不要让用户看到"没听懂"
    if (out.patch.length === 0) {
      const fallback = mockPatch(req);
      if (fallback.patch.length > 0) {
        return {
          ...fallback,
          model: `${out.model}+rule`,
          fallbackNote: '模型未给出可执行修改，已用规则匹配兜底',
        };
      }
    }
    return out;
  } catch (err) {
    const fallback = mockPatch(req);
    return {
      ...fallback,
      model: `${fallback.model}(降级)`,
      fallbackNote: `真实模型调用失败，已降级为规则匹配：${(err as Error).message.slice(0, 120)}`,
    };
  }
}
