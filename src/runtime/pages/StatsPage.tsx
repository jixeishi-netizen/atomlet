'use client';

import type { Entity, Page } from '@/lib/spec/schema';
import type { Row } from '../types';

type StatsPageSpec = Extract<Page, { type: 'stats' }>;

type Props = {
  entity: Entity;
  page: StatsPageSpec;
  rows: Row[];
};

function aggregate(
  rows: Row[],
  fn: 'count' | 'sum' | 'avg' | 'max' | 'min',
  field?: string,
  filter?: { field: string; eq: string | number | boolean },
): number {
  let scope = rows;
  if (filter) {
    scope = scope.filter((r) => String(r.payload[filter.field] ?? '') === String(filter.eq));
  }
  if (fn === 'count') return scope.length;

  const nums = scope
    .map((r) => Number(r.payload[field ?? '']))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return 0;

  switch (fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'max':
      return Math.max(...nums);
    case 'min':
      return Math.min(...nums);
    default:
      return 0;
  }
}

export function StatsPage({ entity, page, rows }: Props) {
  return (
    <div>
      <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
      <p className="mt-1 text-[12px] text-ink-500">
        数据实时来自数据库 · 当前 {rows.length} 条{entity.label}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {page.cards.map((card) => {
          const value = aggregate(rows, card.fn, card.field, card.filter);
          const field = card.field ? entity.fields.find((f) => f.key === card.field) : undefined;
          const isMoney = field?.format === 'money';
          const display =
            card.fn === 'avg'
              ? value.toFixed(1)
              : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
          return (
            <div key={card.label} className="card px-4 py-3">
              <div className="text-[12px] text-ink-500">{card.label}</div>
              <div className="mt-1.5 text-[22px] font-medium leading-none text-[var(--brand-600)]">
                {isMoney ? '¥' : ''}
                {display}
              </div>
              <div className="mt-1 text-[11px] text-ink-300">
                {card.fn === 'count' ? 'COUNT(*)' : `${card.fn.toUpperCase()}(${card.field})`}
              </div>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-ink-100 bg-white/50 px-4 py-8 text-center text-[13px] text-ink-300">
          还没有数据，去「{entity.label}」表单录入一条，这里会自动变化
        </div>
      ) : null}
    </div>
  );
}
