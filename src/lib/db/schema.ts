import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AppSpec, RecordPayload } from '../spec/schema';

export type GenStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
  ms?: number;
};

export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  icon: text('icon').default('clipboard-list').notNull(),
  theme: text('theme').default('neutral').notNull(),
  description: text('description'),
  prompt: text('prompt'),
  currentVersion: integer('current_version').default(1).notNull(),
  ownerId: text('owner_id').default('demo').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const appVersions = pgTable(
  'app_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    spec: jsonb('spec').$type<AppSpec>().notNull(),
    patch: jsonb('patch').$type<unknown>(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uq: uniqueIndex('app_versions_app_version_uq').on(t.appId, t.version) }),
);

export const appRecords = pgTable(
  'app_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    payload: jsonb('payload').$type<RecordPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ idx: index('app_records_app_entity_idx').on(t.appId, t.entity) }),
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    scope: text('scope').default('write').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uq: uniqueIndex('share_links_token_uq').on(t.token) }),
);

/** 对话消息的结构化补充；只用 JSONB 承载，避免每次加字段都改表 */
export type MessageMeta = {
  kind?: 'generate' | 'patch' | 'rollback' | 'failed';
  ops?: number;
  dropped?: number;
  attempts?: number;
  model?: string;
  note?: string | null;
  degraded?: boolean;
  fallbackNote?: string | null;
  instructions?: string[];
};

/**
 * 对话线程：应用页刷新后仍能看到「你说了什么 / 原子做了什么」（见 docs/15）。
 * app_versions.note 只存指令原文，不足以还原一轮交互，所以单独建表。
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    version: integer('version'),
    meta: jsonb('meta').$type<MessageMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ idx: index('messages_app_created_idx').on(t.appId, t.createdAt) }),
);

export const genRuns = pgTable('gen_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id'),
  prompt: text('prompt').notNull(),
  status: text('status').default('running').notNull(),
  model: text('model'),
  attempts: integer('attempts').default(1).notNull(),
  steps: jsonb('steps').$type<GenStep[]>().default([]).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
