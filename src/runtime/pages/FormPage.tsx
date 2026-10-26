'use client';

import { useState } from 'react';
import type { Entity, Page } from '@/lib/spec/schema';
import { validateRecordPayload } from '@/lib/validateRecord';
import { FieldInput, useFormState } from '../FieldInput';

type FormPageSpec = Extract<Page, { type: 'form' }>;

type Props = {
  entity: Entity;
  page: FormPageSpec;
  submitUrl: string;
  onSubmitted?: () => void;
};

export function FormPage({ entity, page, submitUrl, onSubmitted }: Props) {
  const fields = entity.fields;
  const form = useFormState(fields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setMessage(null);
    setGlobalError(null);

    // 提交前先用与服务端同一份实现自校验：不合格就直接标红，不发请求（缺陷 3）
    const local = validateRecordPayload(entity, form.values);
    if (!local.ok) {
      setErrors(local.errors);
      setGlobalError('有字段未通过校验，请检查标红的项');
      return;
    }

    setErrors({});
    setPending(true);

    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: entity.key, payload: local.clean }),
      });
      const data = (await res.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!res.ok) {
        if (data.fieldErrors) setErrors(data.fieldErrors);
        setGlobalError(data.fieldErrors ? '有字段未通过校验，请检查标红的项' : (data.error ?? '提交失败'));
        return;
      }
      form.reset();
      setMessage('已提交，数据已写入数据库');
      onSubmitted?.();
    } catch (err) {
      setGlobalError(`提交失败：${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
      {page.intro ? <p className="mt-1 text-[12px] text-ink-500">{page.intro}</p> : null}

      <form onSubmit={submit} className="mt-4 space-y-4">
        {fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={form.values[field.key]}
            error={errors[field.key]}
            disabled={pending}
            onChange={(value) => form.setValue(field.key, value)}
          />
        ))}

        {globalError ? (
          <div className="rounded-md border border-bad-600/20 bg-bad-50 px-3 py-2 text-[12px] text-bad-600">
            {globalError}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-ok-600/20 bg-ok-50 px-3 py-2 text-[12px] text-ok-600">
            {message}
          </div>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? '提交中…' : (page.submitLabel ?? '提交')}
        </button>
      </form>
    </div>
  );
}
