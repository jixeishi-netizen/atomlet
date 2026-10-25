import { specSchema, type AppSpec } from './spec/schema';
import { validateSpec, type Issue } from './spec/validate';

export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string };

export type DroppedOp = { path: string; reason: string };

const ALLOWED_ROOTS = new Set(['app', 'entities', 'pages', 'sharePolicy']);
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 6;

/**
 * replace 遇到"本来不存在的可选属性"（如 required / enum / format）时按受控 upsert 处理，
 * 否则「把 A 改成必填」这类合法指令会被静默丢弃。只允许写入 AppSpec 已知的属性名，
 * 避免路径写错变成脏数据。
 */
const KNOWN_PROPERTIES = new Set([
  // app
  'name', 'theme', 'description', 'icon',
  // entity / field
  'key', 'label', 'fields', 'type', 'required', 'enum', 'ref', 'format', 'min', 'max', 'placeholder', 'help', 'displayField',
  // page
  'id', 'title', 'entity', 'submitLabel', 'intro', 'columns', 'filters', 'defaultSort', 'pageSize', 'dir',
  'cards', 'groupBy', 'metric', 'chartType', 'fn', 'field', 'filter', 'eq',
  // sharePolicy
  'mode', 'entities',
]);

function parsePointer(path: string): string[] {
  if (path === '' || path === '/') return [];
  if (!path.startsWith('/')) throw new Error(`路径必须以 / 开头：${path}`);
  return path
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** 路径白名单：只允许改 app / entities / pages / sharePolicy 四棵子树（见 docs/15 §3） */
export function checkPath(path: string): { ok: true } | { ok: false; reason: string } {
  let segs: string[];
  try {
    segs = parsePointer(path);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (segs.length === 0) return { ok: false, reason: '不允许替换根节点' };
  if (segs.length > MAX_DEPTH) return { ok: false, reason: `路径层级超过 ${MAX_DEPTH}` };
  if (!ALLOWED_ROOTS.has(segs[0])) {
    return { ok: false, reason: `根节点 ${segs[0]} 不在白名单内（只允许 app/entities/pages/sharePolicy）` };
  }
  if (segs.some((s) => DANGEROUS.has(s))) return { ok: false, reason: '路径含危险键名' };
  return { ok: true };
}

type Node = Record<string, unknown> | unknown[];

function getParent(root: unknown, segs: string[]): { parent: Node; key: string } | null {
  if (segs.length === 0) return null;
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (cur === null || typeof cur !== 'object') return null;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return null;
      cur = cur[idx];
    } else {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) return null;
      cur = obj[seg];
    }
  }
  if (cur === null || typeof cur !== 'object') return null;
  return { parent: cur as Node, key: segs[segs.length - 1] };
}

function readValue(root: unknown, segs: string[]): { found: boolean; value?: unknown } {
  let cur: unknown = root;
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object') return { found: false };
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { found: false };
      cur = cur[idx];
    } else {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) return { found: false };
      cur = obj[seg];
    }
  }
  return { found: true, value: cur };
}

function applyOne(spec: AppSpec, op: PatchOp): { ok: boolean; reason?: string } {
  const target = op.op === 'move' ? op.path : op.path;
  const check = checkPath(target);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (op.op === 'move') {
    const fromCheck = checkPath(op.from);
    if (!fromCheck.ok) return { ok: false, reason: `from: ${fromCheck.reason}` };
  }

  const segs = parsePointer(target);
  const loc = getParent(spec, segs);
  if (!loc) return { ok: false, reason: '路径不存在' };
  const { parent, key } = loc;

  if (op.op === 'add') {
    if (Array.isArray(parent)) {
      const idx = key === '-' ? parent.length : Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) {
        return { ok: false, reason: `数组下标越界：${key}` };
      }
      parent.splice(idx, 0, op.value);
      return { ok: true };
    }
    (parent as Record<string, unknown>)[key] = op.value;
    return { ok: true };
  }

  if (op.op === 'replace') {
    if (Array.isArray(parent)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
        return { ok: false, reason: `数组下标不存在：${key}` };
      }
      parent[idx] = op.value;
      return { ok: true };
    }
    const obj = parent as Record<string, unknown>;
    if (!(key in obj) && !KNOWN_PROPERTIES.has(key)) {
      return {
        ok: false,
        reason: `字段不存在：${key}（replace 只允许写入 AppSpec 已知属性，避免路径写错变成脏数据）`,
      };
    }
    obj[key] = op.value;
    return { ok: true };
  }

  if (op.op === 'remove') {
    if (Array.isArray(parent)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
        return { ok: false, reason: `数组下标不存在：${key}` };
      }
      parent.splice(idx, 1);
      return { ok: true };
    }
    const obj = parent as Record<string, unknown>;
    if (!(key in obj)) return { ok: false, reason: `字段不存在：${key}` };
    delete obj[key];
    return { ok: true };
  }

  if (op.op === 'move') {
    const fromSegs = parsePointer(op.from);
    const captured = readValue(spec, fromSegs);
    if (!captured.found) return { ok: false, reason: `from 路径不存在：${op.from}` };
    const fromLoc = getParent(spec, fromSegs);
    if (!fromLoc) return { ok: false, reason: `from 路径不存在：${op.from}` };
    if (Array.isArray(fromLoc.parent)) {
      fromLoc.parent.splice(Number(fromLoc.key), 1);
    } else {
      delete (fromLoc.parent as Record<string, unknown>)[fromLoc.key];
    }
    const nextLoc = getParent(spec, parsePointer(op.path));
    if (!nextLoc) return { ok: false, reason: '目标路径不存在' };
    if (Array.isArray(nextLoc.parent)) {
      const idx = nextLoc.key === '-' ? nextLoc.parent.length : Number(nextLoc.key);
      nextLoc.parent.splice(idx, 0, captured.value);
    } else {
      (nextLoc.parent as Record<string, unknown>)[nextLoc.key] = captured.value;
    }
    return { ok: true };
  }

  return { ok: false, reason: `不支持的操作：${(op as { op: string }).op}` };
}

export type ApplyResult = {
  spec: AppSpec;
  applied: PatchOp[];
  dropped: DroppedOp[];
};

/** 丢弃制：一条补丁写错不影响其余补丁生效（见 docs/15 §4） */
export function applyPatch(current: AppSpec, ops: PatchOp[]): ApplyResult {
  const next = structuredClone(current) as AppSpec;
  const applied: PatchOp[] = [];
  const dropped: DroppedOp[] = [];

  for (const op of ops) {
    const result = applyOne(next, op);
    if (result.ok) applied.push(op);
    else dropped.push({ path: op.path, reason: result.reason ?? '未知原因' });
  }

  return { spec: next, applied, dropped };
}

export type PostApplyCheck =
  | { ok: true; spec: AppSpec }
  | { ok: false; issues: Issue[] };

/** apply 之后必须重新过结构校验 + 引用完整性，否则不产生新版本（见 docs/15 §5） */
export function validateAfterApply(candidate: unknown): PostApplyCheck {
  const parsed = specSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 8).map((i) => ({
        code: i.code.toUpperCase(),
        path: i.path.join('.') || 'root',
        message: i.message,
      })),
    };
  }
  const issues = validateSpec(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: parsed.data };
}

export function summarizeDropped(dropped: DroppedOp[]): string {
  return dropped.map((d) => `${d.path}：${d.reason}`).join('；');
}
