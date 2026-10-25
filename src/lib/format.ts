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

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
