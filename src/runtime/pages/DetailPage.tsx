'use client';

import type { Entity, Page } from '@/lib/spec/schema';
import { formatDateTime, formatValue } from '@/lib/format';
import type { Row } from '../types';

type DetailPageSpec = Extract<Page, { type: 'detail' }>;

type Props = {
  entity: Entity;
  page: DetailPageSpec;
  record?: Row;
  onBack?: () => void;
};

export function DetailPage({ entity, page, record, onBack }: Props) {
  const keys = page.fields && page.fields.length > 0 ? page.fields : entity.fields.map((f) => f.key);
  const fields = keys
    .map((k) => entity.fields.find((f) => f.key === k))
    .filter((f): f is Entity['fields'][number] => Boolean(f));

  if (!record) {
    return (
      <div>
        <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
        <div className="mt-4 rounded-lg border border-dashed border-ink-100 bg-white/50 px-4 py-10 text-center text-[13px] text-ink-300">
          在列表页点任意一行的「详情」查看完整字段
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
          <p className="mt-1 text-[12px] text-ink-500">
            创建于 {formatDateTime(record.createdAt)} · {record.id.slice(0, 8)}
          </p>
        </div>
        {onBack ? (
          <button type="button" className="btn-ghost !py-1" onClick={onBack}>
            返回列表
          </button>
        ) : null}
      </div>

      <dl className="card mt-4 divide-y divide-ink-100">
        {fields.map((field) => (
          <div key={field.key} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2.5">
            <dt className="text-[12px] text-ink-500">{field.label}</dt>
            <dd className="whitespace-pre-wrap text-[13px] text-ink-900">
              {field.type === 'longtext'
                ? (String(record.payload[field.key] ?? '—') || '—')
                : formatValue(field, record.payload[field.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
