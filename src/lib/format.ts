import type { Field } from './spec/schema';

/** 客户端与服务器共用的格式化逻辑（不能依赖 node:crypto 等 Node 内置模块） */
export function formatValue(field: Field, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'bool') return value ? '是' : '否';
  if (field.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    if (field.format === 'money') {
      return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
    }
    if (field.format === 'percent') return `${num}%`;
    return num.toLocaleString('zh-CN');
  }
  if (field.type === 'longtext') {
    const text = String(value);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }
  return String(value);
}

/**
 * 时间统一按北京时间显示。
 * 不用 getHours() 这类进程本地时区方法：容器默认 UTC，页面会比北京时间慢 8 小时。
 */
const DISPLAY_TZ = 'Asia/Shanghai';

function tzParts(d: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(d)) out[part.type] = part.value;
  if (out.hour === '24') out.hour = '00';
  return out;
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = tzParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function formatTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const p = tzParts(d);
  return `${p.hour}:${p.minute}`;
}
