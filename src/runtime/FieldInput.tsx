'use client';

import { useMemo, useState } from 'react';
import type { Field } from '@/lib/spec/schema';

type Props = {
  field: Field;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (value: unknown) => void;
};

export function FieldInput({ field, value, error, disabled, onChange }: Props) {
  const id = `f_${field.key}`;
  const str = value === undefined || value === null ? '' : String(value);

  if (field.type === 'bool') {
    return (
      <div>
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input
            id={id}
            type="checkbox"
            checked={value === true || value === 'true'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-[var(--brand-600)] focus:ring-[var(--brand-500)]"
          />
          {field.label}
        </label>
        <FieldError error={error} />
      </div>
    );
  }

  return (
    <div>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="ml-1 text-bad-600">*</span> : null}
      </label>

      {field.type === 'longtext' ? (
        <textarea
          id={id}
          className="input min-h-[80px] resize-y"
          value={str}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'enum' ? (
        <select
          id={id}
          className="input"
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">请选择</option>
          {(field.enum ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          type={
            field.type === 'number'
              ? 'number'
              : field.type === 'date'
                ? 'date'
                : field.type === 'url'
                  ? 'url'
                  : 'text'
          }
          value={str}
          placeholder={field.placeholder}
          // 只有 number 才带 min/max：让浏览器先挡一层，服务端仍然是最终裁判
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.help ? <p className="mt-1 text-[11px] text-ink-300">{field.help}</p> : null}
      <FieldError error={error} />
    </div>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="mt-1 text-[11px] text-bad-600">{error}</p>;
}

export function useFormState(fields: Field[]) {
  const initial = useMemo(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) init[f.key] = f.type === 'bool' ? false : '';
    return init;
  }, [fields]);

  const [values, setValues] = useState<Record<string, unknown>>(initial);

  return {
    values,
    setValue: (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value })),
    reset: () => setValues(initial),
  };
}
