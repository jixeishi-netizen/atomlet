/**
 * 字段级校验的唯一实现（客户端表单 / 服务端接口共用一份，见 docs/06 ADR-01）。
 *
 * 这个文件**不允许** import 任何 db / node 内置模块，
 * 否则表单端就无法在提交前做同一套校验（缺陷：0 元记录绕过下限）。
 */
import type { Entity, RecordPayload } from './spec/schema';

export type RecordValidation = {
  ok: boolean;
  errors: Record<string, string>;
  clean: RecordPayload;
};

const MONEY_LABEL_RE = /金额|费用|价格|成本|工资|报销|收入|支出/;

/** 下限文案要带出约束值，否则用户只知道"填错了"却不知道要求是多少 */
function minMessage(label: string, min: number, fieldFormat?: string): string {
  if (min === 0.01 && (fieldFormat === 'money' || MONEY_LABEL_RE.test(label))) {
    return `${label}必须大于 0（最小 ${min}）`;
  }
  return `${label}必须大于等于 ${min}`;
}

export function validateRecordPayload(entity: Entity, payload: RecordPayload): RecordValidation {
  const errors: Record<string, string> = {};
  const clean: RecordPayload = {};

  for (const field of entity.fields) {
    const raw = payload[field.key];
    const empty = raw === undefined || raw === null || raw === '';

    if (empty) {
      if (field.required) errors[field.key] = `请填写${field.label}`;
      continue;
    }

    switch (field.type) {
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (Number.isNaN(num)) {
          errors[field.key] = `${field.label}必须是数字`;
          break;
        }
        if (field.min !== undefined && num < field.min) {
          errors[field.key] = minMessage(field.label, field.min, field.format);
          break;
        }
        if (field.max !== undefined && num > field.max) {
          errors[field.key] = `${field.label}不能大于 ${field.max}`;
          break;
        }
        clean[field.key] = num;
        break;
      }
      case 'bool': {
        clean[field.key] = raw === true || raw === 'true' || raw === 'on' || raw === 1;
        break;
      }
      case 'enum': {
        const value = String(raw);
        if (!field.enum?.includes(value)) {
          errors[field.key] = `${field.label}取值必须是：${field.enum?.join(' / ')}`;
          break;
        }
        clean[field.key] = value;
        break;
      }
      case 'date': {
        const value = String(raw).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors[field.key] = `${field.label}格式应为 YYYY-MM-DD`;
          break;
        }
        clean[field.key] = value;
        break;
      }
      case 'url': {
        const value = String(raw);
        if (!/^https?:\/\//i.test(value)) {
          errors[field.key] = `${field.label}必须以 http(s):// 开头`;
          break;
        }
        clean[field.key] = value;
        break;
      }
      case 'longtext': {
        const value = String(raw);
        if (value.length > 2000) {
          errors[field.key] = `${field.label}不能超过 2000 字`;
          break;
        }
        clean[field.key] = value;
        break;
      }
      default: {
        const value = String(raw);
        if (value.length > 200) {
          errors[field.key] = `${field.label}不能超过 200 字`;
          break;
        }
        clean[field.key] = value;
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, clean };
}
