# 07 生成链路与 AppSpec 详细设计

> 项目：Atomlet（小原子）｜本文是架构核心，决定生成成功率与可维护性
> 上游：06 总体架构 ADR-02/03/04 ｜下游：08 数据模型（spec 存储形态）、09 部署（超时与限额）

## 1. AppSpec 完整示例（门店巡检）

JSONC 注释仅用于本文档，落库时是纯 JSON。这份 spec 同时作为 `prompts/v1.builder.ts` 的 few-shot 示例，两边必须保持一致。

```jsonc
{
  "specVersion": "1.0",
  "app": { "name": "门店巡检", "icon": "clipboard-check", "theme": "neutral",   // theme 只有三套，避免样式发散
           "description": "按门店与巡检项记录每日检查结果，跟踪整改进度" },
  "entities": [
    { "name": "store", "label": "门店", "fields": [
      { "name": "name", "label": "门店名称", "type": "text", "required": true, "unique": true },
      { "name": "city", "label": "城市", "type": "enum", "required": true, "enum": ["北京","上海","深圳"] },
      { "name": "manager", "label": "店长", "type": "text", "required": false } ]},
    { "name": "inspection", "label": "巡检记录", "fields": [                       // name 规则 ^[a-z][a-zA-Z0-9]{1,30}$，直接作为 JSONB key
      { "name": "store", "label": "所属门店", "type": "ref", "required": true,
        "ref": { "entity": "store", "displayField": "name" } },                    // 引用完整性校验点
      { "name": "item", "label": "巡检项", "type": "enum", "required": true,
        "enum": ["消防通道","冷藏温度","价签一致性","员工着装"] },
      { "name": "result", "label": "结果", "type": "enum", "required": true,
        "enum": ["合格","待整改","不合格"], "default": "合格" },
      { "name": "score", "label": "评分", "type": "number", "min": 0, "max": 100 },
      { "name": "inspectedAt", "label": "巡检时间", "type": "date", "required": true },
      { "name": "inspector", "label": "巡检人", "type": "text", "required": true },
      { "name": "photoUrl", "label": "现场照片", "type": "url" },
      { "name": "fixed", "label": "已整改", "type": "bool", "default": false },
      { "name": "note", "label": "备注", "type": "longtext" } ]} ],
  "pages": [
    { "id":"p_new","type":"form","title":"新建巡检记录","entity":"inspection","mode":"create",
      "fields":["store","item","result","score","inspectedAt","inspector","photoUrl","note"],
      "submitAction":"createInspection","successMessage":"巡检记录已保存" },        // action 必须存在于 actions
    { "id":"p_list","type":"table","title":"巡检记录","entity":"inspection",
      "columns":[{"field":"inspectedAt","label":"时间"},{"field":"store","label":"门店"},
                 {"field":"item","label":"巡检项"},{"field":"result","label":"结果"},
                 {"field":"inspector","label":"巡检人"}],
      "filters":[{"field":"result","op":"eq"},{"field":"inspector","op":"contains"}],
      "defaultSort":{"field":"inspectedAt","dir":"desc"},"pageSize":20,"rowAction":"detail" },
    { "id":"p_board","type":"board","title":"整改看板","entity":"inspection",
      "groupBy":"result","titleField":"item",                                     // groupBy 必须是本 entity 的 enum 字段
      "cardFields":["store","inspectedAt","inspector"],"updateAction":"updateInspection" },
    { "id":"p_stats","type":"stats","title":"本周概览","entity":"inspection",
      "cards":[{"label":"巡检总数","fn":"count"},
               {"label":"平均分","fn":"avg","field":"score","unit":"分"},
               {"label":"不合格数","fn":"count","filter":{"field":"result","op":"eq","value":"不合格"}}] },
    { "id":"p_chart","type":"chart","title":"不合格趋势","entity":"inspection","chartType":"line",
      "dimension":{"field":"inspectedAt","bucket":"day"},
      "metric":{"fn":"count","filter":{"field":"result","op":"eq","value":"不合格"}} },
    { "id":"p_detail","type":"detail","title":"记录详情","entity":"inspection",
      "fields":["store","item","result","score","inspectedAt","inspector","photoUrl","fixed","note"] } ],
  "actions": [
    { "name":"createInspection","kind":"create","entity":"inspection" },
    { "name":"queryInspections","kind":"query","entity":"inspection" },
    { "name":"updateInspection","kind":"update","entity":"inspection" },
    { "name":"deleteInspection","kind":"delete","entity":"inspection" },
    { "name":"avgScoreByStore","kind":"aggregate","entity":"inspection",
      "fn":"avg","field":"score","groupBy":"store" } ],
  "sharePolicy": { "enabled": true, "scope": "write",                            // read | write
                   "entities": ["inspection"], "expiresInDays": 7 }              // 限定可写实体，避免外部改门店主数据
}
```

顶层约束：`specVersion` 固定 `"1.0"`（不匹配拒载）；`app.name` ≤ 20 字，`icon`/`theme` 走白名单；`entities` 长度 1–6 且 `name` 全局唯一；`pages` 长度 1–8、`id` 唯一、至少含一个 `form` 或 `table`；`actions` 中被引用者必须存在。

## 2. 六个页面类型的字段定义

公共字段：`id`（`^p_[a-z0-9]{1,12}$`，patch 定位锚点，必填）｜`type`（6 选 1，必填）｜`title`（≤ 16 字，必填）｜`entity`（必须是 `entities[].name`，必填）。

> `aggregations` 不设独立顶层键。它在本 schema 里只用于两处出数：`stats.cards[].fn` 与 `chart.metric.fn`，两处共用同一个 `AggFn`（count/sum/avg/max/min）。拆成独立顶层数组会让"哪个页面用哪条聚合"需要二次引用解析，多一层悬空引用风险，对校验和 Builder 都不划算。

| 类型 | props | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| **form** | `fields` | string[] | 是 | 字段名数组，非空；顺序即渲染顺序 |
| | `mode` | enum | 是 | `create` / `edit`（edit 需配合 detail 传 recordId） |
| | `submitAction` | string | 是 | 指向 `kind=create/update` 的 action |
| | `successMessage` | string | 否 | 缺省"已保存" |
| **table** | `columns` | Column[] | 是 | `{field, label?, width?}`；`field` 必须在 entity 内 |
| | `filters` | Filter[] | 否 | `{field, op: eq\|contains\|gte\|lte, value?}`；无 value 渲染为可交互筛选器 |
| | `defaultSort` | `{field, dir}` | 否 | `dir` 为 `asc`/`desc`；`field` 不存在则整项丢弃 |
| | `pageSize` | number | 否 | 10/20/50，缺省 20 |
| | `rowAction` | enum | 否 | `detail` 时点击行跳详情 |
| **detail** | `fields` | string[] | 是 | 展示字段，按序排列 |
| | `related` | Related[] | 否 | `{entity, foreignField, displayFields[]}`：反查引用本记录的关联记录 |
| **stats** | `cards` | StatCard[] | 是 | `{label, fn: count\|sum\|avg\|max\|min, field?, filter?, unit?}` |
| | `compare` | enum | 否 | `none`/`week`/`month` 环比 |
| **board** | `groupBy` | string | 是 | 必须是本 entity 的 `enum` 字段，否则降级为 table |
| | `titleField` | string | 是 | 卡片主标题字段 |
| | `cardFields` | string[] | 是 | 卡片副信息（最多 3 个） |
| | `updateAction` | string | 否 | 有则支持拖动改 `groupBy` 字段值 |
| **chart** | `chartType` | enum | 是 | `bar`/`line`/`donut`（与 14 组件契约一致，渲染器不接受其他值） |
| | `dimension` | object | 是 | `{field, bucket?: day\|week\|month}`；bucket 仅 `date` 字段可用 |
| | `metric` | object | 是 | `{fn, field?, filter?}` |
| | `limit` | number | 否 | 缺省 30，防止 X 轴过密 |

字段类型 9 种（与渲染器一对一）：`text`（≤200 字）｜`longtext`（≤2000 字）｜`number`（受 min/max 约束）｜`date`（`YYYY-MM-DD`）｜`enum`（必须 ∈ enum 数组）｜`bool`｜`url`（仅 http/https）｜`ref`（目标实体存在且 id 有效，存目标 record id）｜`user`（取 session，客户端不可伪造）。

## 3. 三个智能体的契约

### 3.1 Planner：只决定"有什么"，不决定"长什么样"

骨架错的重来成本是 1.2k 输出，props 错的成本是 4k 输出，所以先收敛骨架。

| 项 | 内容 |
|---|---|
| system 要点 | ① 内部工具建模专家；② 严格匹配给定 JSON Schema，不多键不少键；③ 实体 ≤ 3、页面 ≤ 6、字段 ≤ 12/实体；④ 有界取值优先用 `enum`；⑤ 字段名小驼峰英文；⑥ `rationale` 中文 ≤ 120 字说明拆分理由 |
| 输入 | `{ requirement, columnsHint?: [{name, inferredType, enumValues?}], componentCatalog }` |
| 输出 | `{ appName, rationale, entities: [{name, label, fields: [{name, label, type, sampleValue?}]}], pages: [{type, title, entity, purpose}], actions: [{kind, entity}], openQuestions: string[] }` |
| 明确不输出 | 任何 props 细节（columns/filters/cards），全部留给 Builder |

### 3.2 Builder：把骨架补全为合法 AppSpec

| 项 | 内容 |
|---|---|
| system 要点 | ① 输出单个 JSON 对象，无 markdown 包裹无解释；② `type` 只能取 9 种之一；③ 每个 table 必须有 `defaultSort`；④ 每个 stats 页至少 2 张卡；⑤ 引用的字段名必须逐字来自 entity；⑥ 不确定时选保守类型（text 优于 enum，除非样例值域明确 ≤ 8 种） |
| 输入 | `{ blueprint, jsonSchema, samples: 每列前 5 行样例 }` |
| 输出 | 完整 AppSpec（第 1 节形态） |
| 硬约束 | provider 侧 `jsonSchema` 参数做结构约束；解析失败 → 把 parse error 位置回灌，重试 1 次 |

### 3.3 Critic：语义层校验，只出问题单不改 spec

| 项 | 内容 |
|---|---|
| system 要点 | ① 严格评审员，只报可定位可操作的问题；② 每条必须给 `path`（JSON Pointer）与 `suggest`；③ 不报"样式不好看"；④ 最多 8 条按严重度降序；⑤ 任一 `error` 则 `verdict=fail` |
| 输入 | `{ spec, rendererCapabilities }` |
| 输出 | `{ verdict: "pass"\|"fail", issues: [{level, path, code, message, suggest}] }` |
| Issue code（闭集） | `FIELD_NOT_IN_ENTITY`、`ENTITY_NOT_FOUND`、`ACTION_MISSING`、`MISSING_REQUIRED_PROP`、`TYPE_NOT_RENDERABLE`、`GROUP_BY_NOT_ENUM`（以上 error）；`SEMANTIC_TYPE_MISMATCH`、`ENUM_TOO_MANY`（>30 项）、`LOW_VALUE_PAGE`（以上 warn）。前端据此出提示文案 |

## 4. 上下文拼装策略

**首次生成**：`system = PROMPT_SYSTEM[agent]`（固定、版本化）；`user = ["## 用户需求", requirement(原话不改写), "## 表格列推断", JSON(columnsHint), "## 组件能力清单", CATALOG_TEXT, "## 输出要求", OUTPUT_CONTRACT[agent]].join("\n")`。其中 `CATALOG_TEXT` 由 `runtime/registry.ts` 生成，保证"prompt 说的能力 = 渲染器真有的能力"。

**增量修改**：核心原则是**当前生效 spec 是唯一事实源**；历史 patch 只作为"用户意图演变"的辅助信号，且只带最近 3 条一句话摘要，不带完整 patch。

| 段 | 内容 | token 预算 |
|---|---|---|
| `## 当前应用规格` | 当前版本 spec 的裁剪版 JSON | ≤ 6,000 |
| `## 最近修改` | 最近 3 条 `{at, summary}` | ≤ 400 |
| `## 本次指令` | 用户原话 | ≤ 300 |
| `## 允许的修改路径` | 白名单前缀 + 示例 | ≤ 200 |
| `## 输出契约` | RFC 6902 子集 + 示例 | ≤ 300 |

裁剪规则（序列化后 > 6k tokens 触发）：`entities` 全量保留（patch 最常改实体，裁掉会让模型瞎猜字段名）；`pages[].columns/cards` 保留但省略空 `label`；`detail` 页的 `fields` 省略（派生页）；`actions` 只留 `name/kind/entity`；`sharePolicy` 保留。不做全量历史累积的理由：① 每轮多 1–2k tokens，5 轮后 prompt 翻倍；② 历史 patch 可能互相回滚（A→B→A），带上反而诱导模型重复应用已撤销的变更。

## 5. 校验规则清单（机械校验，纯代码）

顺序固定：schema → 引用 → 可渲染 → 业务规则；**前面失败就不跑后面**，避免错误信息互相淹没。

| # | 规则 | 失败后果 | 错误码 |
|---|---|---|---|
| V1 | zod 解析（discriminated union 按 `type` 分支） | fail | `SCHEMA_INVALID` |
| V2 | `page.entity` ∈ `entities[].name` | fail | `ENTITY_NOT_FOUND` |
| V3 | `columns[].field` / `fields[]` ∈ 对应 entity 字段 | 删该列 + warn；列空则 fail | `FIELD_NOT_IN_ENTITY` |
| V4 | `field.ref.entity` 存在且 `displayField` ∈ 该 entity 字段 | fail | `REF_BROKEN` |
| V5 | `submitAction` / `updateAction` ∈ `actions[].name` | fail | `ACTION_MISSING` |
| V6 | `page.type` ∈ 6 种、`field.type` ∈ 9 种 | fail | `TYPE_NOT_RENDERABLE` |
| V7 | 非空：`entities[].fields`、form.`fields`、table.`columns`、stats.`cards` | fail | `MISSING_REQUIRED_PROP` |
| V8 | `defaultSort.field` 存在（columns 或 entity.fields） | 丢 `defaultSort` + warn | `SORT_FIELD_MISSING` |
| V9 | `filters[].field` 存在 | 丢该 filter + warn | `FILTER_FIELD_MISSING` |
| V10 | enum 字段 `enum.length ≥ 1`；board 的 `groupBy` 要求 ≥ 2 | fail | `ENUM_INVALID` |
| V11 | entity/field `^[a-z][a-zA-Z0-9]{1,30}$`；page.id `^p_[a-z0-9]{1,12}$` | fail | `NAME_INVALID` |
| V12 | 字段名不重复（fail）、page title 不重复（warn） | 见左 | `DUPLICATE_NAME` |

### 5.1 三级兜底

| 级别 | 触发条件 | 动作 | 调模型 | 用户可见表现 |
|---|---|---|---|---|
| **L1 重试** | V1–V12 有 error | error 列表按 `path` 排序后作为 `feedback` 回灌 Builder，最多 3 次 | 是 | 进度条"正在修复第 N 次" |
| **L2 局部修复** | L1 用尽仍有可机械修复的问题 | 确定性算法就地修：删越界列 / 丢非法 sort 与 filter / enum 为空降级 text / 补 `successMessage` / board 的 `groupBy` 非 enum 则改 type 为 table；修完重跑 V1–V12 | 否 | 静默 |
| **L3 模板兜底** | L1+L2 后仍 fail，或总耗时 > 90s | 按相似度选模板，合并用户实体字段，返回 `degraded=true` | 否 | 顶部黄条：「本次生成未完全成功，已基于"巡检/填报"模板生成，原因：X。可点重试」 |

模板相似度：`score = 0.6 * jaccard(pageTypeSet) + 0.4 * jaccard(fieldTypeSet)`。模板库只做 3 个（时间盒只允许 0.2h）：`inspection`（form+table+board+stats）、`crm`（form+table+detail+stats+chart）、`ticket`（form+table+detail+board），覆盖 golden set 约 80% 场景。

## 6. 重试状态机

`gen_runs.status` 与 `gen_steps.agent` 双写，便于事后逐步骤复盘。

```
PENDING ─▶ PARSING ─▶ PLANNING ─▶ BUILDING ─▶ CRITIQUING ─(0 error)────────▶ COMMITTING ─▶ DONE
              │           │            │           ├─(error, attempt<3)─▶ REPAIRING ─▶ CRITIQUING
              │           │            │           └─(attempt=3)────────▶ LOCAL_FIXING
              │           │            │                              ├─(通过)──▶ COMMITTING
              │           │            │                              └─(失败)──▶ TEMPLATING ─▶ DEGRADED
              │           │            └─(JSON 不可解析且未重试)──▶ BUILDING
              │           └─(超时且未重试)──▶ PLANNING
              └─(无表头/全空)──▶ FAILED
任意状态 ──(run 超时 90s / provider 5xx 连续 2 次)──▶ FAILED
```

| 迁移条件 | 从 | 到 | 副作用 |
|---|---|---|---|
| 解析成功 | PARSING | PLANNING | 写 `gen_steps(agent=parser, status=ok)` |
| 解析失败（不可恢复） | PARSING | FAILED | `error=PARSE_FAILED`，**不消耗模型 token** |
| planner 超时（> 15s） | PLANNING | PLANNING | `attempt+1` |
| builder JSON 不可解析 | BUILDING | BUILDING | parse error 位置写进 `feedback`，重试 1 次 |
| critic 报 error 且 `attempt < 3` | CRITIQUING | REPAIRING | `feedback = issues` |
| `attempt >= 3` | REPAIRING | LOCAL_FIXING | 记录降级候选原因 |
| 局部修复通过 / 失败 | LOCAL_FIXING | COMMITTING / TEMPLATING | 通过时 `gen_runs.note = "auto-fixed: n 处"` |
| 模板生成完成 | TEMPLATING | DEGRADED | 响应带 `degraded/templateId/reason` |
| 事务写库成功 | COMMITTING | DONE | 返回 `appId` + `versionNo` |

`attempt` 是**全局计数器**（跨阶段累加），不是每阶段独立计数。这样"planner 重试 2 次 + builder 重试 2 次"不会变成 4 次，避免成本失控。

## 7. 提示词版本管理约定

| 约定 | 说明 |
|---|---|
| 文件即版本 | `prompts/v1.{planner,builder,critic,patch}.ts`；**改 prompt 必须新建 v2 文件，禁止原地改 v1** |
| 导出版本号 | 每个文件导出 `PROMPT_ID = "planner@v1"`，写入 `gen_steps.output.promptId` |
| 可复现 | 任一历史 `gen_runs` 可查到当时的 `promptId` + `model`，可重放 |
| A/B 方式 | `runGeneration({ promptSet: 'v2' })` 显式传入，默认取 `DEFAULT_PROMPT_SET` 常量 |
| 回归门禁 | 改 prompt 必须跑 `scripts/golden-set.ts`，通过率低于上一版则不合入 |
| 唯一事实源 | 能力清单 `CATALOG_TEXT` 由 registry 生成，不手写，防止"prompt 说支持但渲染器没有" |

## 8. 生成质量评估方法

Golden Set（10 条，覆盖不同考点）：

| # | 需求摘要 | 关键考点 | # | 需求摘要 | 关键考点 |
|---|---|---|---|---|---|
| G01 | 门店每日巡检，看整改进度 | enum+board+日期趋势 | G06 | 客户回访按城市看分布 | 二级实体+donut |
| G02 | 销售线索登记与跟进状态 | ref+状态流转+筛选 | G07 | 库存盘点差异登记 | number min/max |
| G03 | 设备报修工单，含优先级责任人 | enum+user 字段 | G08 | 培训签到与出勤率 | date bucket+百分比 |
| G04 | 员工周报提交与汇总 | longtext+stats 计数 | G09 | 会议纪要归档与检索 | longtext+contains |
| G05 | 采购申请与审批金额统计 | number 聚合+filter 卡 | G10 | 供应商资质到期提醒 | date+排序+enum 超限降级 |

判定口径：**pass** = 一次生成 + ≤1 次重试后机械校验 0 error、Critic 0 error，且人工判定"能完成一次完整录入并在列表看到该数据"；**partial** = 机械校验通过但人工需 ≥ 2 次手工修补才可用；**fail** = 触发 L3 模板兜底、端到端 > 90s，或需要人工改代码。

**通过率** = `pass / 10`。验收标准：**≥ 8/10 达标，7/10 为可交付下限**；`partial` 单独统计并附"最常见 3 类缺陷"，作为下一版 prompt 的改进输入。执行方式：`npx tsx scripts/golden-set.ts --prompt v1 --model deepseek --out report.md`，输出每条三态、耗时、tokens、失败 issue 列表；不依赖数据库（in-memory fixture），可重复跑。

## 9. token 与延迟预算

| 阶段 | 输入 tokens | 输出 tokens | P50 | P95 | 备注 |
|---|---|---|---|---|---|
| parser（纯代码） | 0 | 0 | 0.1s | 0.3s | 不调模型 |
| planner | 3,000 | 1,500 | 3s | 8s | 首 token ≈ 0.6s |
| builder | 6,500 | 4,000 | 13s | 26s | 流式，用户可感知进度 |
| critic | 6,000 | 800 | 4s | 9s | — |
| repair（1.3 系数摊） | 6,500 | 2,700 | 5s | 12s | 平均 0.3 次/run |
| 渲染 + 落库 | 0 | 0 | 0.5s | 1s | — |
| **合计** | **≈ 22,000** | **≈ 9,000** | **≈ 25s** | **≈ 50s** | 与 01 文档第 3 节一致 |

超时阈值：单次 provider 调用 45s 硬超时；整个 run 90s 硬超时（触发 L3）。SSE 每 15s 一条 `event: ping` 防止中间设备断连。

## 10. 实现代价估算

| 子模块 | 内容 | 工时 | 归属任务（见 01 文档第 4 节） |
|---|---|---|---|
| `spec/schema.ts` | zod 19 个嵌套 schema + TS 类型导出 + `toJsonSchema` | 0.3h | 任务 2（部分） |
| `spec/validate.ts` | V1–V12 规则 + 结构化 error | 0.25h | 任务 2（部分） |
| `spec/patch.ts` | RFC 6902 四操作 apply + path 白名单 | 0.2h | 任务 6（部分） |
| `llm/provider.ts` + `deepseek.ts` | 统一接口 + jsonSchema 约束 + 流式 | 0.15h | 任务 3（部分） |
| `agents/prompts/*` × 4 | system + user 模板 + 输出契约 | 0.25h | 任务 3（部分） |
| `agents/orchestrator.ts` | 状态机 + 重试 + L1/L2/L3 兜底 | 0.3h | 任务 3（部分） |
| `agents/templates/*` × 3 | 3 个兜底模板 spec | 0.2h | 任务 3（部分） |
| `parse/table.ts` | CSV 解析 + 类型推断 + 枚举识别 | 0.15h | 任务 4（部分） |
| `scripts/golden-set.ts` | 10 条需求批量跑 + 报告 | 0.1h | 任务 7（部分） |
| **小计** | | **1.9h** | |

剩余工时（渲染器 1.05h + 数据层 0.7h + SSE 接入与落库 0.4h + 版本/回滚交互 0.5h + 集成联调 0.5h 等）分别记在 01/08 文档对应任务中，P0 合计仍为 6.0h，不重复计算。

## 11. 已知取舍

| 取舍 | 决定 | 理由 |
|---|---|---|
| Planner 只出骨架 | 不一次生成完整 spec | 骨架错的重来成本 1.2k 输出，完整 spec 错要 4k |
| patch 路径不存在 | 整条丢弃 + 提示，不重生成 | 重生成会丢用户已录入数据的绑定关系，且破坏版本 diff 可读性 |
| Critic 不修 spec | 只出问题单 | 让"修"集中在 repair 一次调用，减少调用次数与状态 |
| 模板库只做 3 个 | 不做六组件全组合 | 覆盖约 80% 场景，时间盒只允许 0.2h |
| 不做 spec 版本迁移器 | 只在 `specVersion` 不匹配时拒载 | MVP 只有一个版本，迁移器是 P2 |
