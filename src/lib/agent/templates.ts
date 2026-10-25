import type { AppSpec, Entity, Field } from '../spec/schema';

type Template = {
  keys: RegExp;
  build: (prompt: string) => AppSpec;
};

const commonDetail = { id: 'p_detail', type: 'detail' as const, title: '记录详情', entity: 'record' };

const repair: AppSpec = {
  specVersion: '1.0',
  app: {
    name: '设备报修工单',
    theme: 'cool',
    icon: 'wrench',
    description: '设备故障报修登记与维修进度跟踪',
  },
  entities: [
    {
      key: 'record',
      label: '报修工单',
      fields: [
        { key: 'deviceNo', label: '设备编号', type: 'text', required: true, placeholder: '如 EQ-2031' },
        { key: 'deviceName', label: '设备名称', type: 'text' },
        { key: 'fault', label: '故障描述', type: 'longtext', required: true, placeholder: '现象、发生时间、是否停机' },
        { key: 'reporter', label: '报修人', type: 'text', required: true },
        {
          key: 'urgency',
          label: '紧急程度',
          type: 'enum',
          required: true,
          enum: ['一般', '紧急', '停机待修'],
        },
        {
          key: 'status',
          label: '处理状态',
          type: 'enum',
          required: true,
          enum: ['待派单', '维修中', '已完工'],
        },
        { key: 'reportDate', label: '报修日期', type: 'date', required: true },
        { key: 'cost', label: '维修费用', type: 'number', min: 0, format: 'money' },
      ],
    },
  ],
  pages: [
    {
      id: 'p_form',
      type: 'form',
      title: '提交报修',
      entity: 'record',
      submitLabel: '提交工单',
      intro: '填写设备编号与故障现象，提交后进入待派单队列',
    },
    {
      id: 'p_list',
      type: 'table',
      title: '工单列表',
      entity: 'record',
      columns: [
        { field: 'deviceNo' },
        { field: 'reporter' },
        { field: 'urgency' },
        { field: 'status' },
        { field: 'reportDate' },
      ],
      filters: [{ field: 'status' }, { field: 'urgency' }],
      defaultSort: { field: 'reportDate', dir: 'desc' },
      pageSize: 20,
    },
    {
      id: 'p_stats',
      type: 'stats',
      title: '维修概览',
      entity: 'record',
      cards: [
        { label: '工单总数', fn: 'count' },
        { label: '待派单', fn: 'count', filter: { field: 'status', eq: '待派单' } },
        { label: '停机待修', fn: 'count', filter: { field: 'urgency', eq: '停机待修' } },
        { label: '维修费用合计', fn: 'sum', field: 'cost' },
      ],
    },
    commonDetail,
  ],
  sharePolicy: { mode: 'write', entities: ['record'] },
};

const inspection: AppSpec = {
  specVersion: '1.0',
  app: {
    name: '门店巡检',
    theme: 'neutral',
    icon: 'clipboard-check',
    description: '门店日常巡检登记，自动汇总得分与整改情况',
  },
  entities: [
    {
      key: 'record',
      label: '巡检记录',
      fields: [
        { key: 'store', label: '门店名称', type: 'text', required: true, placeholder: '如 深圳福田店' },
        {
          key: 'area',
          label: '所属区域',
          type: 'enum',
          required: true,
          enum: ['华南', '华东', '华北', '西南'],
        },
        { key: 'inspectDate', label: '巡检日期', type: 'date', required: true },
        { key: 'inspector', label: '巡检人', type: 'text', required: true },
        { key: 'score', label: '巡检得分', type: 'number', required: true, min: 0, max: 100 },
        { key: 'fixed', label: '是否已整改', type: 'bool' },
        { key: 'issue', label: '发现问题', type: 'longtext', placeholder: '描述现场问题与整改要求' },
      ],
    },
  ],
  pages: [
    {
      id: 'p_form',
      type: 'form',
      title: '录入巡检',
      entity: 'record',
      submitLabel: '提交巡检',
      intro: '到店巡检后填写，提交即计入汇总',
    },
    {
      id: 'p_list',
      type: 'table',
      title: '巡检记录',
      entity: 'record',
      columns: [
        { field: 'store' },
        { field: 'inspectDate' },
        { field: 'area' },
        { field: 'score' },
        { field: 'fixed' },
      ],
      filters: [{ field: 'area' }],
      defaultSort: { field: 'inspectDate', dir: 'desc' },
      pageSize: 20,
    },
    {
      id: 'p_stats',
      type: 'stats',
      title: '巡检概览',
      entity: 'record',
      cards: [
        { label: '巡检总数', fn: 'count' },
        { label: '平均得分', fn: 'avg', field: 'score' },
        { label: '最高得分', fn: 'max', field: 'score' },
        { label: '最低得分', fn: 'min', field: 'score' },
      ],
    },
    commonDetail,
  ],
  sharePolicy: { mode: 'write', entities: ['record'] },
};

const expense: AppSpec = {
  specVersion: '1.0',
  app: {
    name: '费用报销',
    theme: 'warm',
    icon: 'receipt',
    description: '员工费用报销登记与审批状态跟踪',
  },
  entities: [
    {
      key: 'record',
      label: '报销单',
      fields: [
        { key: 'applicant', label: '申请人', type: 'text', required: true },
        {
          key: 'dept',
          label: '所属部门',
          type: 'enum',
          required: true,
          enum: ['销售部', '市场部', '运营部', '技术部'],
        },
        { key: 'amount', label: '报销金额', type: 'number', required: true, min: 0, format: 'money' },
        {
          key: 'category',
          label: '费用类型',
          type: 'enum',
          required: true,
          enum: ['差旅', '业务招待', '办公用品', '其他'],
        },
        { key: 'spendDate', label: '发生日期', type: 'date', required: true },
        { key: 'invoiceNo', label: '发票号', type: 'text' },
        { key: 'paid', label: '是否已打款', type: 'bool' },
        { key: 'note', label: '事由说明', type: 'longtext' },
      ],
    },
  ],
  pages: [
    {
      id: 'p_form',
      type: 'form',
      title: '提交报销',
      entity: 'record',
      submitLabel: '提交报销单',
      intro: '填写发票信息与金额，提交后进入待打款列表',
    },
    {
      id: 'p_list',
      type: 'table',
      title: '报销记录',
      entity: 'record',
      columns: [
        { field: 'applicant' },
        { field: 'dept' },
        { field: 'amount' },
        { field: 'category' },
        { field: 'spendDate' },
        { field: 'paid' },
      ],
      filters: [{ field: 'dept' }, { field: 'category' }],
      defaultSort: { field: 'spendDate', dir: 'desc' },
      pageSize: 20,
    },
    {
      id: 'p_stats',
      type: 'stats',
      title: '报销概览',
      entity: 'record',
      cards: [
        { label: '报销笔数', fn: 'count' },
        { label: '报销总额', fn: 'sum', field: 'amount' },
        { label: '单笔均值', fn: 'avg', field: 'amount' },
      ],
    },
    commonDetail,
  ],
  sharePolicy: { mode: 'write', entities: ['record'] },
};

const lead: AppSpec = {
  specVersion: '1.0',
  app: {
    name: '客户线索',
    theme: 'cool',
    icon: 'users',
    description: '销售线索登记与跟进阶段管理',
  },
  entities: [
    {
      key: 'record',
      label: '线索',
      fields: [
        { key: 'company', label: '公司名称', type: 'text', required: true },
        { key: 'contact', label: '联系人', type: 'text', required: true },
        { key: 'phone', label: '联系电话', type: 'text', placeholder: '手机号或固话' },
        {
          key: 'stage',
          label: '跟进阶段',
          type: 'enum',
          required: true,
          enum: ['新线索', '已联系', '已报价', '已成交', '已流失'],
        },
        { key: 'amount', label: '预估金额', type: 'number', min: 0, format: 'money' },
        { key: 'followDate', label: '下次跟进', type: 'date' },
        { key: 'owner', label: '负责人', type: 'user' },
        { key: 'note', label: '沟通记录', type: 'longtext' },
      ],
    },
  ],
  pages: [
    {
      id: 'p_form',
      type: 'form',
      title: '登记线索',
      entity: 'record',
      submitLabel: '保存线索',
      intro: '录入客户基本信息与当前阶段',
    },
    {
      id: 'p_list',
      type: 'table',
      title: '线索列表',
      entity: 'record',
      columns: [
        { field: 'company' },
        { field: 'contact' },
        { field: 'stage' },
        { field: 'amount' },
        { field: 'followDate' },
      ],
      filters: [{ field: 'stage' }],
      defaultSort: { field: 'followDate', dir: 'asc' },
      pageSize: 20,
    },
    {
      id: 'p_stats',
      type: 'stats',
      title: '销售概览',
      entity: 'record',
      cards: [
        { label: '线索总数', fn: 'count' },
        { label: '预估金额合计', fn: 'sum', field: 'amount' },
        { label: '平均金额', fn: 'avg', field: 'amount' },
      ],
    },
    commonDetail,
  ],
  sharePolicy: { mode: 'write', entities: ['record'] },
};

const generic: AppSpec = {
  specVersion: '1.0',
  app: {
    name: '事项登记',
    theme: 'neutral',
    icon: 'clipboard-list',
    description: '通用事项登记与状态跟踪',
  },
  entities: [
    {
      key: 'record',
      label: '事项',
      fields: [
        { key: 'title', label: '事项标题', type: 'text', required: true },
        {
          key: 'category',
          label: '分类',
          type: 'enum',
          required: true,
          enum: ['日常', '重要', '紧急'],
        },
        { key: 'dueDate', label: '截止日期', type: 'date' },
        { key: 'done', label: '是否完成', type: 'bool' },
        { key: 'detail', label: '详细说明', type: 'longtext' },
      ],
    },
  ],
  pages: [
    {
      id: 'p_form',
      type: 'form',
      title: '新增事项',
      entity: 'record',
      submitLabel: '提交',
      intro: '登记一件需要跟踪的事项',
    },
    {
      id: 'p_list',
      type: 'table',
      title: '事项列表',
      entity: 'record',
      columns: [{ field: 'title' }, { field: 'category' }, { field: 'dueDate' }, { field: 'done' }],
      filters: [{ field: 'category' }],
      defaultSort: { field: 'dueDate', dir: 'asc' },
      pageSize: 20,
    },
    {
      id: 'p_stats',
      type: 'stats',
      title: '事项概览',
      entity: 'record',
      cards: [{ label: '事项总数', fn: 'count' }],
    },
    commonDetail,
  ],
  sharePolicy: { mode: 'write', entities: ['record'] },
};

const TEMPLATES: Template[] = [
  { keys: /报修|维修|工单|设备故障|修理|故障/, build: () => structuredClone(repair) },
  { keys: /巡检|检查|门店|整改|安全/, build: () => structuredClone(inspection) },
  { keys: /报销|费用|发票|差旅|报销单/, build: () => structuredClone(expense) },
  { keys: /客户|线索|CRM|crm|销售|跟进|商机/, build: () => structuredClone(lead) },
];

function inferType(values: string[]): Field['type'] {
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (clean.length === 0) return 'text';
  if (clean.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'number';
  if (clean.every((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v))) return 'date';
  const uniq = new Set(clean);
  if (uniq.size <= 6 && clean.length >= 3) return 'enum';
  return 'text';
}

/** 从 CSV 表头推断实体字段：这是"上传一张表就长出系统"的核心推断逻辑 */
export function entityFromCsv(csv: string): Entity | null {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 1) return null;

  const splitRow = (row: string) =>
    row
      .split(',')
      .map((c) => c.replace(/^"|"$/g, '').trim())
      .filter((c, i, arr) => !(c === '' && arr.length > 1 && i === arr.length - 1));

  const header = splitRow(lines[0]);
  if (header.length === 0) return null;

  const rows = lines.slice(1, 61).map(splitRow);
  const fields: Field[] = header.slice(0, 8).map((raw, i) => {
    const label = raw || `字段${i + 1}`;
    const key = `f${i + 1}`;
    const values = rows.map((r) => r[i] ?? '');
    const type = inferType(values);
    const uniq = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).slice(0, 12);
    const field: Field = { key, label: label.slice(0, 24), type };
    if (i === 0) field.required = true;
    if (type === 'enum') field.enum = uniq;
    return field;
  });

  return { key: 'record', label: '记录', fields };
}

export function specFromCsv(csv: string, prompt: string): AppSpec | null {
  const entity = entityFromCsv(csv);
  if (!entity) return null;

  const numericField = entity.fields.find((f) => f.type === 'number');
  const dateField = entity.fields.find((f) => f.type === 'date');
  const enumField = entity.fields.find((f) => f.type === 'enum');
  const textFields = entity.fields.filter((f) => f.type === 'text');

  const columns = [
    ...textFields.slice(0, 2).map((f) => ({ field: f.key })),
    ...(dateField ? [{ field: dateField.key }] : []),
    ...(numericField ? [{ field: numericField.key }] : []),
    ...(enumField ? [{ field: enumField.key }] : []),
  ].slice(0, 5);
  if (columns.length === 0) entity.fields.slice(0, 4).forEach((f) => columns.push({ field: f.key }));

  // 应用名：优先用命中的业务场景名，其次用需求里提炼的短名，最后兜底
  const sceneName = (() => {
    const matched = specFromPrompt(prompt);
    return matched.matched === 'generic' ? null : matched.spec.app.name;
  })();
  const cleaned = prompt
    .replace(/[，。！？,.!?、：:；;]/g, '')
    .replace(/这是|帮我|做成系统|做一个|我要|导出|上传|表格|系统|的/g, '')
    .trim()
    .slice(0, 12);
  const name = sceneName ?? (cleaned.length >= 2 ? cleaned : '数据登记');

  type StatCard = { label: string; fn: 'count' | 'sum' | 'avg'; field?: string };
  const cards: StatCard[] = [{ label: '记录总数', fn: 'count' }];
  if (numericField) {
    cards.push({ label: `${numericField.label}合计`, fn: 'sum', field: numericField.key });
    cards.push({ label: `${numericField.label}均值`, fn: 'avg', field: numericField.key });
  }

  return {
    specVersion: '1.0',
    app: { name, theme: 'neutral', icon: 'table', description: `由表格导入：${entity.fields.length} 个字段` },
    entities: [entity],
    pages: [
      {
        id: 'p_form',
        type: 'form',
        title: '新增记录',
        entity: 'record',
        submitLabel: '提交',
        intro: `字段根据表格表头自动识别（${entity.fields.length} 个）`,
      },
      {
        id: 'p_list',
        type: 'table',
        title: '数据列表',
        entity: 'record',
        columns,
        filters: enumField ? [{ field: enumField.key }] : undefined,
        ...(dateField ? { defaultSort: { field: dateField.key, dir: 'desc' as const } } : {}),
        pageSize: 20,
      },
      {
        id: 'p_stats',
        type: 'stats',
        title: '数据概览',
        entity: 'record',
        cards,
      },
      commonDetail,
    ],
    sharePolicy: { mode: 'write', entities: ['record'] },
  };
}

export function specFromPrompt(prompt: string): { spec: AppSpec; matched: string } {
  for (const t of TEMPLATES) {
    if (t.keys.test(prompt)) {
      const spec = t.build(prompt);
      spec.app.description = `${prompt.slice(0, 40)}`.trim() || spec.app.description;
      return { spec, matched: spec.app.name };
    }
  }
  const spec = structuredClone(generic);
  return { spec, matched: 'generic' };
}
