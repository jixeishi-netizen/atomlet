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
          // step="any" 必须显式给：input[type=number] 默认 step=1，配合 min=0.01 会让浏览器
          // 认为合法值是 0.01 / 1.01 / 2.01…，于是 20 这种正常金额被原生校验判为"步长错误"
          // （浏览器提示"最接近的两个值是 19.01 和 20.01"，请求根本发不出去）。
          // min/max 表达业务约束，step 只表达精度：业务值不能被 step 卡住，所以这里用 any。
          step={field.type === 'number' ? 'any' : undefined}
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
