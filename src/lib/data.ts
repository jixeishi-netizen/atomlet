import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { appRecords, appVersions, apps, shareLinks } from './db/schema';
import type { AppSpec, Entity, Field, RecordPayload } from './spec/schema';

export type AppRow = typeof apps.$inferSelect;
export type RecordRow = typeof appRecords.$inferSelect;
export type VersionRow = typeof appVersions.$inferSelect;

export function newToken(len = 12): string {
  return randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, len);
}

export async function listApps() {
  return db.select().from(apps).orderBy(desc(apps.createdAt)).limit(50);
}

export async function getApp(id: string) {
  const [row] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
  return row ?? null;
}

export async function getCurrentSpec(appId: string, version: number): Promise<AppSpec | null> {
  const [row] = await db
    .select()
    .from(appVersions)
    .where(and(eq(appVersions.appId, appId), eq(appVersions.version, version)))
    .limit(1);
  return row?.spec ?? null;
}

export async function listVersions(appId: string) {
  return db
    .select({
      id: appVersions.id,
      version: appVersions.version,
      note: appVersions.note,
      patch: appVersions.patch,
      createdAt: appVersions.createdAt,
    })
    .from(appVersions)
    .where(eq(appVersions.appId, appId))
    .orderBy(desc(appVersions.version))
    .limit(30);
}

export async function getVersion(appId: string, version: number) {
  const [row] = await db
    .select()
    .from(appVersions)
    .where(and(eq(appVersions.appId, appId), eq(appVersions.version, version)))
    .limit(1);
  return row ?? null;
}

/** 版本号单调递增；写入版本与更新 apps 当前指针必须在同一事务（见 docs/08 §1） */
export async function bumpVersion(input: {
  appId: string;
  spec: AppSpec;
  patch: unknown;
  note: string;
}): Promise<number> {
  const { appId, spec, patch, note } = input;
  const [latest] = await db
    .select({ version: appVersions.version })
    .from(appVersions)
    .where(eq(appVersions.appId, appId))
    .orderBy(desc(appVersions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx.insert(appVersions).values({ appId, version, spec, patch, note });
    await tx
      .update(apps)
      .set({
        currentVersion: version,
        name: spec.app.name,
        theme: spec.app.theme,
        description: spec.app.description ?? null,
        updatedAt: new Date(),
      })
      .where(eq(apps.id, appId));
  });

  return version;
}

export async function getRecords(appId: string, entity: string): Promise<RecordRow[]> {
  return db
    .select()
    .from(appRecords)
    .where(and(eq(appRecords.appId, appId), eq(appRecords.entity, entity)))
    .orderBy(desc(appRecords.createdAt))
    .limit(500);
}

export async function getRecordsByEntity(appId: string, entities: string[]) {
  const out: Record<string, RecordRow[]> = {};
  for (const entity of entities) {
    out[entity] = await getRecords(appId, entity);
  }
  return out;
}

export async function getShareLink(appId: string) {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.appId, appId))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getAppByToken(token: string) {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
  if (!link) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;
  const app = await getApp(link.appId);
  if (!app) return null;
  const spec = await getCurrentSpec(app.id, app.currentVersion);
  if (!spec) return null;
  return { app, spec, link };
}

export async function createAppFromSpec(input: {
  spec: AppSpec;
  prompt: string;
  model: string;
}): Promise<{ app: AppRow; shareToken: string }> {
  const { spec, prompt, model } = input;
  const [app] = await db
    .insert(apps)
    .values({
      name: spec.app.name,
      icon: spec.app.icon ?? 'clipboard-list',
      theme: spec.app.theme,
      description: spec.app.description ?? null,
      prompt,
      currentVersion: 1,
    })
    .returning();

  await db.insert(appVersions).values({
    appId: app.id,
    version: 1,
    spec,
    note: `初始生成 · ${model}`,
  });

  const token = newToken();
  await db.insert(shareLinks).values({
    appId: app.id,
    token,
    scope: spec.sharePolicy.mode,
  });

  return { app, shareToken: token };
}

export type RecordValidation = {
  ok: boolean;
  errors: Record<string, string>;
  clean: RecordPayload;
};

/** 字段级校验：统一表存 JSONB，所以类型约束必须在这一层守住（见 docs/06 ADR-01） */
export function validateRecordPayload(
  entity: Entity,
  payload: RecordPayload,
): RecordValidation {
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
          errors[field.key] = `${field.label}不能小于 ${field.min}`;
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

export async function insertRecord(appId: string, entity: string, payload: RecordPayload) {
  const [row] = await db
    .insert(appRecords)
    .values({ appId, entity, payload })
    .returning();
  return row;
}

export function formatValue(field: Field, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'bool') return value ? '是' : '否';
  if (field.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    if (field.format === 'money') return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
    if (field.format === 'percent') return `${num}%`;
    return num.toLocaleString('zh-CN');
  }
  if (field.type === 'longtext') {
    const text = String(value);
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }
  return String(value);
}
