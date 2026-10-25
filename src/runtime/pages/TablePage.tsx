'use client';

import { useMemo, useState } from 'react';
import type { Entity, Field, Page } from '@/lib/spec/schema';
import { formatValue } from '@/lib/format';
import type { Row } from '../types';

type TablePageSpec = Extract<Page, { type: 'table' }>;

type Props = {
  entity: Entity;
  page: TablePageSpec;
  rows: Row[];
  onRowClick?: (row: Row) => void;
};

export function TablePage({ entity, page, rows, onRowClick }: Props) {
  const fieldOf = (key: string): Field | undefined => entity.fields.find((f) => f.key === key);
  const filters = page.filters ?? [];
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | undefined>(
    page.defaultSort,
  );
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = page.pageSize ?? 20;

  const filtered = useMemo(() => {
    let out = rows;
    for (const f of filters) {
      const v = filterValues[f.field];
      if (!v) continue;
      out = out.filter((r) => String(r.payload[f.field] ?? '') === v);
    }
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a.payload[sort.field];
        const bv = b.payload[sort.field];
        const an = typeof av === 'number' ? av : Number(av);
        const bn = typeof bv === 'number' ? bv : Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') return (an - bn) * dir;
        return String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN') * dir;
      });
    }
    return out;
  }, [rows, filters, filterValues, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(pageIndex, totalPages - 1);
  const view = filtered.slice(current * pageSize, current * pageSize + pageSize);

  function toggleSort(field: string) {
    setSort((prev) =>
      prev?.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    );
    setPageIndex(0);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
          <p className="mt-1 text-[12px] text-ink-500">
            共 {filtered.length} 条{filtered.length !== rows.length ? `（全部 ${rows.length} 条）` : ''}
          </p>
        </div>
        {filters.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => {
              const field = fieldOf(f.field);
              if (!field) return null;
              return (
                <select
                  key={f.field}
                  className="input !w-auto !py-1.5 text-[12px]"
                  value={filterValues[f.field] ?? ''}
                  onChange={(e) => {
                    setFilterValues((prev) => ({ ...prev, [f.field]: e.target.value }));
                    setPageIndex(0);
                  }}
                >
                  <option value="">{f.label ?? field.label}：全部</option>
                  {(field.enum ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="card mt-3 overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-[12px] text-ink-500">
              {page.columns.map((col) => {
                const field = fieldOf(col.field);
                if (!field) return null;
                const active = sort?.field === col.field;
                return (
                  <th key={col.field} className="whitespace-nowrap px-3 py-2 font-medium">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-ink-900"
                      onClick={() => toggleSort(col.field)}
                    >
                      {col.label ?? field.label}
                      <span className="text-[10px] text-ink-300">
                        {active ? (sort?.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr>
                <td
                  colSpan={page.columns.length + 1}
                  className="px-3 py-10 text-center text-[13px] text-ink-300"
                >
                  还没有数据。去「{entity.label}」表单提交一条试试。
                </td>
              </tr>
            ) : (
              view.map((row) => (
                <tr key={row.id} className="border-b border-ink-100/70 last:border-0 hover:bg-ink-50/40">
                  {page.columns.map((col) => {
                    const field = fieldOf(col.field);
                    if (!field) return null;
                    return (
                      <td key={col.field} className="max-w-[220px] truncate px-3 py-2 text-ink-700">
                        {formatValue(field, row.payload[col.field])}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-[12px] text-brand-600 hover:underline"
                      onClick={() => onRowClick?.(row)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-[12px] text-ink-500">
          <span>
            第 {current + 1} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost !py-1"
              disabled={current === 0}
              onClick={() => setPageIndex(current - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="btn-ghost !py-1"
              disabled={current >= totalPages - 1}
              onClick={() => setPageIndex(current + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
