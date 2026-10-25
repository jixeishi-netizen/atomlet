# Atomlet（小原子）

> 把一张表格，长成一个能用的系统。

多智能体驱动的内部小工具生成器：上传一份 CSV 或说一句业务痛点，生成一套带真实数据库的应用（录入表单 / 记录列表 / 详情 / 统计看板），支持外部填报链接与真实落库。

配套文档见 [`docs/00_README.md`](docs/00_README.md)（16 份，含可行性、需求、架构、接口、测试与风险）；
本轮真实模型实测结果见 [`docs/16_测试执行报告.md`](docs/16_测试执行报告.md)。

---

## 一分钟启动

```bash
# 1) 起数据库（本机 5432 被占用，这里映射到 55432）
docker compose -f docker-compose.dev.yml up -d

# 2) 建表 + 灌种子数据（4 个示例应用）
npm run db:push
npm run db:seed

# 3) 跑起来
npm run build && npm run start   # 生产模式，稳定
# 或：npm run dev                 # 开发模式，热更新
```

打开 http://localhost:3000 。

**重置演示环境**（面试前建议跑一次，清掉脏数据）：

```bash
npm run db:reset && npm run db:seed
```

---

## 已经跑通的能力

| 能力 | 入口 | 验证状态 |
|---|---|---|
| 一句话生成应用（三阶段智能体 + 校验重试） | `/new` | SSE 流式，实际跑通 |
| CSV 表头推断字段与类型 | `/new` 上传 | 5 列 → 5 字段，日期/数值/枚举识别正确 |
| 六类页面的渲染（form / table / detail / stats，board / chart 降级提示） | `/apps/[id]` | 页面可切换、排序、筛选、分页 |
| 记录真实入库（含字段级校验） | 表单提交 | 缺必填/枚举非法返回 422 并标红 |
| 统计卡实时聚合 | `/apps/[id]` 统计页 | 数字随记录变化 |
| 分享链接外部填报（免登录） | `/p/[token]` | 移动端布局，写入同一库 |
| 生成过程可观测 | `gen_runs` 表 | 步骤、状态、错误、耗时都落库 |
| **一句话改需求（JSON Patch）** | 应用页底部「用一句话改这个应用」 | 改必填 / 加字段 / 加列 / 加卡片 / 改名 / 换主题，落新版本 |
| **版本回滚** | 应用页右上「版本 vN」 | 回滚＝复制成新版本，历史不删，可再回滚 |
| **patch 守护自检** | `npm run check:patch` | 越界丢弃、危险键拒绝、删被引用字段被拦，7 项断言 |

## 还没做（P1，按 docs 的优先级）

- xlsx 直接解析（现在走「另存为 CSV」）
- `board` 分组看板、`chart` 图表组件
- 登录与多租户（当前所有应用归属 `demo` 用户）
- patch 的可视化 diff 预览（现在只显示"应用了 N 处"）

---

## 目录结构

```
src/
├── app/
│   ├── page.tsx                    工作台
│   ├── new/                        新建（SSE 流式生成）
│   ├── apps/[id]/                  应用预览（渲染 AppSpec）
│   ├── p/[token]/                  外部填报（免登录）
│   └── api/
│       ├── apps/generate           生成（SSE）
│       ├── apps/[id]/records       写入记录
│       ├── apps/[id]/chat          增量修改（SSE，输出 JSON Patch）
│       ├── apps/[id]/versions      版本列表
│       ├── apps/[id]/versions/[vid]/rollback  回滚（复制成新版本）
│       ├── public/[token]/records  外部填报写入
│       └── healthz                 健康检查
├── lib/
│   ├── spec/schema.ts              AppSpec 的 zod 定义（唯一事实来源）
│   ├── spec/validate.ts            引用完整性校验（JSON Schema 查不出的那层）
│   ├── agent/pipeline.ts           三阶段编排 + 校验回灌重试
│   ├── agent/provider.ts           mock / OpenAI 兼容双通道
│   ├── agent/templates.ts          场景模板 + CSV 字段推断
│   ├── agent/patchAgent.ts         指令 → JSON Patch（mock 规则 / 真实模型双通道）
│   ├── patch.ts                    路径白名单 + apply + 丢弃制 + 校验链
│   ├── db/schema.ts                7 张表的 drizzle 定义
│   └── data.ts                     查询、建应用、记录校验
└── runtime/
    ├── AppRenderer.tsx             按 AppSpec 渲染，换 spec 就换应用
    └── pages/                      form / table / detail / stats
```

---

## 三条设计约束（面试时会问）

1. **模型只输出 AppSpec，不输出 HTML。** 换来可校验、可 patch、可回滚；代价是表达力锁在 6 个组件内。
2. **不做运行时 DDL。** 逻辑上「一应用一套模型」，物理上是统一 `app_records` 表 + JSONB + `app_id` 隔离 + 应用层字段校验。避开注入面与迁移失控。
3. **生成失败三级兜底。** Schema 校验 → 引用完整性校验 → 带错误回灌重试（最多 3 次）；仍失败则明确报错，不假装成功。

## 切换真实模型

**推荐方式：改 `model.config.json`（普通文件，不会被文件浏览器隐藏）**

```json
{
  "provider": "openai",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "apiKey": "sk-xxx",
  "port": 3100
}
```

然后启动：

```bash
npm run start:model    # 生产模式（先 npm run build）
npm run dev:model      # 开发模式
```

`apiKey` 留空就自动走 mock；填了就自动切真实通道，启动日志会打印当前通道。
`model.config.json` 已加入 `.gitignore`（含密钥，不要提交）。

**备选方式：改 `.env`**（点开头文件，某些编辑器默认不显示；VS Code 里 `Ctrl+P` 输入 `.env` 可打开）

```
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
```

通义（DashScope 兼容端点）同理：

```
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

链路不变（同样的 schema 约束、同样的校验与重试），只是 Builder 换成真模型。默认 `mock` 是本地确定性生成，克隆下来无需任何 key 即可跑通。

**降级兜底**：真实模型调用失败时（401/403/429/超时/返回非 JSON），自动降级到 mock 继续出结果，并在生成过程的日志里标注「⚠ 真实模型调用失败，已降级为模板生成：<原因>」。不白屏，也不隐瞒。

验证降级是否生效：把 key 改成一个错的再生成一次，应该看到应用照常产出 + 一条降级说明。

**注意**：`next start` 会复用构建时烘进 `required-server-files.json` 的环境变量，直接改 `.env` 再重启不会生效。用 `npm run start:model` 启动（它会把 `.env` 显式注入子进程），或者改完 `.env` 重新 `npm run build`。

## 真实模型实测（deepseek-flash，2026-10-25）

跑 `npm run bench` 对 10 条不同业务描述做端到端生成：

| 指标 | 结果 |
|---|---|
| 一次通过（Critic 首轮无问题） | 9 / 10（90%） |
| 三次重试内通过 | 10 / 10（100%） |
| 降级为模板 | 0 |
| 失败 | 0 |
| 平均耗时 | 6.7s（最快 3.7s，最慢 20.7s） |

唯一一条重试的是「客户投诉处理台账」——首次输出未通过引用完整性校验，带错误回灌后第二次通过。复现同一条首次即通过，说明是模型输出波动而非固定缺陷。

改需求通道（JSON Patch）另测 3 条：改必填、加字段、加平均分卡片均一次成功；把"配色改成紫色"时模型输出了 `purple`（非法枚举），被 apply 后的 zod 校验拦下，**未产生坏版本**。

## 已知限制

- 单实例部署：生成并发用进程内信号量限流（`maxConcurrent=3`），多实例会失效（见 docs/06 ADR-05）
- 本机 5432 端口被其他 Postgres 占用，开发库映射到 **55432**
- 唯一字段校验是「先查后写」，存在并发窗口（docs/06 ADR-01 已记录）
