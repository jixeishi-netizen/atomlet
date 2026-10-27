import { z } from 'zod';

/** 字段类型白名单：9 种，与渲染器控件一对一（见 docs/07） */
export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'date',
  'enum',
  'bool',
  'url',
  'ref',
  'user',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const key = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '字段 key 只能是字母/数字/下划线');

export const fieldSchema = z.object({
  key,
  label: z.string().min(1).max(24),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  enum: z.array(z.string().min(1)).min(1).max(12).optional(),
  ref: z
    .object({ entity: z.string().min(1), displayField: z.string().min(1) })
    .optional(),
  format: z.enum(['plain', 'money', 'percent']).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().max(40).optional(),
  help: z.string().max(60).optional(),
});

export const entitySchema = z.object({
  key: z.string().min(1).max(32).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(24),
  fields: z.array(fieldSchema).min(1).max(12),
});

const pageCommon = {
  id: z.string().min(1),
  title: z.string().min(1).max(24),
  entity: z.string().min(1),
};

export const formPageSchema = z.object({
  ...pageCommon,
  type: z.literal('form'),
  submitLabel: z.string().max(12).optional(),
  intro: z.string().max(80).optional(),
});

export const tablePageSchema = z.object({
  ...pageCommon,
  type: z.literal('table'),
  columns: z
    .array(z.object({ field: z.string(), label: z.string().optional() }))
    .min(1)
    .max(8),
  filters: z
    .array(z.object({ field: z.string(), label: z.string().optional() }))
    .max(3)
    .optional(),
  defaultSort: z
    .object({ field: z.string(), dir: z.enum(['asc', 'desc']) })
    .optional(),
  pageSize: z.number().int().min(5).max(100).optional(),
});

export const detailPageSchema = z.object({
  ...pageCommon,
  type: z.literal('detail'),
  fields: z.array(z.string()).max(12).optional(),
});

export const statsPageSchema = z.object({
  ...pageCommon,
  type: z.literal('stats'),
  cards: z
    .array(
      z.object({
        label: z.string().min(1).max(16),
        fn: z.enum(['count', 'sum', 'avg', 'max', 'min']),
        field: z.string().optional(),
        filter: z
          .object({ field: z.string(), eq: z.union([z.string(), z.number(), z.boolean()]) })
          .optional(),
      }),
    )
    .min(1)
    .max(6),
});

export const boardPageSchema = z.object({
  ...pageCommon,
  type: z.literal('board'),
  groupBy: z.string(),
  metric: z.object({ label: z.string(), fn: z.enum(['count', 'sum', 'avg']), field: z.string().optional() }),
});

/**
 * 交互式页面：由内置引擎渲染，不是数据 CRUD。
 * 存在的意义：用户说"做一个 2048"时，输出必须是能玩的游戏，而不是"对局记录本"。
 */
/**
 * 交互式页面的两种实现：
 * - 2048：内置引擎，确定性渲染，质量稳定
 * - custom：模型生成的单文件 HTML，在沙箱 iframe 里跑，用来覆盖内置引擎没做的事（贪吃蛇/俄罗斯方块/计算器等）
 */
export const GAME_ENGINES = ['2048', 'custom'] as const;

export const gamePageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(24),
  type: z.literal('game'),
  game: z.enum(GAME_ENGINES),
  entity: z.string().optional(),
  intro: z.string().max(80).optional(),
  /** game === 'custom' 时必填：自包含的单文件 HTML（内联 CSS/JS，不引用外部资源） */
  html: z.string().max(120000).optional(),
});

export const chartPageSchema = z.object({
  ...pageCommon,
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'donut']),
  groupBy: z.string(),
  metric: z.object({ label: z.string(), fn: z.enum(['count', 'sum', 'avg']) }),
});

export const pageSchema = z.discriminatedUnion('type', [
  formPageSchema,
  tablePageSchema,
  detailPageSchema,
  statsPageSchema,
  boardPageSchema,
  chartPageSchema,
  gamePageSchema,
]);

export const specSchema = z.object({
  specVersion: z.literal('1.0'),
  app: z.object({
    name: z.string().min(2).max(20),
    theme: z.enum(['neutral', 'warm', 'cool']),
    description: z.string().max(60).optional(),
    icon: z.string().max(24).optional(),
  }),
  entities: z.array(entitySchema).max(4),
  pages: z.array(pageSchema).min(1).max(6),
  sharePolicy: z.object({
    mode: z.enum(['read', 'write']),
    entities: z.array(z.string()),
  }),
});

export type AppSpec = z.infer<typeof specSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Page = z.infer<typeof pageSchema>;
export type RecordPayload = Record<string, unknown>;
