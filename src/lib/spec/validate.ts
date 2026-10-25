import type { AppSpec, Entity, Page } from './schema';

export type Issue = {
  code: string;
  path: string;
  message: string;
};

const NUMERIC_FNS = new Set(['sum', 'avg', 'max', 'min']);

/**
 * 引用完整性校验：JSON Schema 查不出「page 引用了不存在的 entity / 字段」，
 * 而那正是运行时白屏的直接原因（见 docs/07 V1-V12）。
 */
export function validateSpec(spec: AppSpec): Issue[] {
  const issues: Issue[] = [];
  const entities = new Map<string, Entity>(spec.entities.map((e) => [e.key, e]));
  const fieldKeys = (entityKey: string) =>
    new Set((entities.get(entityKey)?.fields ?? []).map((f) => f.key));

  if (spec.entities.length === 0) {
    issues.push({ code: 'NO_ENTITY', path: 'entities', message: '至少需要一个实体' });
  }

  // 实体字段唯一性 + enum / ref 合法性
  for (const [ei, entity] of spec.entities.entries()) {
    const seen = new Set<string>();
    for (const [fi, field] of entity.fields.entries()) {
      const at = `entities[${ei}].fields[${fi}]`;
      if (seen.has(field.key)) {
        issues.push({ code: 'DUP_FIELD', path: at, message: `字段 ${field.key} 重复` });
      }
      seen.add(field.key);
      if (field.type === 'enum' && !field.enum?.length) {
        issues.push({ code: 'ENUM_EMPTY', path: at, message: `枚举字段 ${field.key} 缺少可选值` });
      }
      if (field.type === 'ref') {
        if (!field.ref) {
          issues.push({ code: 'REF_MISSING', path: at, message: `引用字段 ${field.key} 缺少 ref` });
        } else {
          const target = entities.get(field.ref.entity);
          if (!target) {
            issues.push({ code: 'REF_BROKEN', path: at, message: `引用目标实体 ${field.ref.entity} 不存在` });
          } else if (!target.fields.some((f) => f.key === field.ref!.displayField)) {
            issues.push({
              code: 'REF_DISPLAY_BROKEN',
              path: at,
              message: `引用展示字段 ${field.ref.displayField} 不在实体 ${field.ref.entity} 中`,
            });
          }
        }
      }
      if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issues.push({ code: 'RANGE_INVERTED', path: at, message: `字段 ${field.key} 的 min 大于 max` });
      }
    }
  }

  // 页面引用完整性
  const pageIds = new Set<string>();
  for (const [pi, page] of spec.pages.entries()) {
    const at = `pages[${pi}]`;
    if (pageIds.has(page.id)) {
      issues.push({ code: 'DUP_PAGE', path: at, message: `页面 id ${page.id} 重复` });
    }
    pageIds.add(page.id);

    if (!entities.has(page.entity)) {
      issues.push({ code: 'PAGE_ENTITY_MISSING', path: at, message: `页面引用的实体 ${page.entity} 不存在` });
      continue;
    }
    const keys = fieldKeys(page.entity);
    const checkField = (field: string, where: string) => {
      if (!keys.has(field)) {
        issues.push({ code: 'PAGE_FIELD_MISSING', path: `${at}.${where}`, message: `字段 ${field} 不在实体 ${page.entity} 中` });
      }
    };

    if (page.type === 'table') {
      for (const col of page.columns) checkField(col.field, `columns.${col.field}`);
      for (const f of page.filters ?? []) checkField(f.field, `filters.${f.field}`);
      if (page.defaultSort) checkField(page.defaultSort.field, 'defaultSort');
    }
    if (page.type === 'detail') {
      for (const f of page.fields ?? []) checkField(f, 'fields');
    }
    if (page.type === 'stats') {
      for (const card of page.cards) {
        if (NUMERIC_FNS.has(card.fn)) {
          if (!card.field) {
            issues.push({ code: 'AGG_NO_FIELD', path: at, message: `${card.label} 使用 ${card.fn} 但未指定字段` });
          } else {
            checkField(card.field, 'cards');
            const f = entities.get(page.entity)!.fields.find((x) => x.key === card.field);
            if (f && f.type !== 'number') {
              issues.push({ code: 'AGG_NOT_NUMERIC', path: at, message: `${card.label} 的字段 ${card.field} 不是数值类型` });
            }
          }
        }
        if (card.filter) checkField(card.filter.field, 'cards.filter');
      }
    }
    if (page.type === 'board' || page.type === 'chart') {
      checkField(page.groupBy, 'groupBy');
    }
  }

  // 分享策略
  for (const e of spec.sharePolicy.entities) {
    if (!entities.has(e)) {
      issues.push({ code: 'SHARE_ENTITY_MISSING', path: 'sharePolicy.entities', message: `分享实体 ${e} 不存在` });
    }
  }

  // 主流程可演示性：必须有一个可提交的表单，否则"生成即能用"不成立
  if (!spec.pages.some((p: Page) => p.type === 'form')) {
    issues.push({ code: 'NO_FORM_PAGE', path: 'pages', message: '缺少表单页，用户无法录入数据' });
  }

  return issues;
}

export function summarizeIssues(issues: Issue[]): string {
  return issues
    .slice(0, 6)
    .map((i) => `- [${i.code}] ${i.path}: ${i.message}`)
    .join('\n');
}
