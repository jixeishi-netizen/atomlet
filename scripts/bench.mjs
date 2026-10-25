/**
 * 生成质量基准：跑一组业务描述，统计真实模型的「一次通过率 / 耗时 / 降级 / 失败」。
 *
 *   node scripts/bench.mjs            # 默认跑 10 条，打 http://127.0.0.1:3100
 *   node scripts/bench.mjs 5          # 只跑前 5 条
 *   BASE=http://host:3000 node scripts/bench.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';

const PROMPTS = [
  '做一个车间设备保养计划表，记录设备名称、保养周期、上次保养日期、下次保养日期、负责人',
  '我要一个车间安全事故上报系统，记录事故类型、发生时间、涉及人员、处理结果',
  '供应商准入登记，记录供应商名称、品类、资质有效期、准入状态、评分',
  '员工工时填报，记录员工、项目、日期、工时数、工作内容',
  '客户投诉处理台账，记录客户、投诉类型、诉求、处理状态、负责人',
  '物料领用登记，记录物料名称、领用数量、领用人、领用日期、用途',
  '安全培训签到表，记录培训主题、讲师、参训人、签到时间、是否通过考核',
  '项目风险登记册，记录风险描述、等级、责任人、应对措施、状态',
  '会议室预约登记，记录会议室、预约人、开始时间、结束时间、用途',
  '退货换货登记，记录订单号、商品、退货原因、处理方式、退款金额',
];

async function runOne(prompt) {
  const startedAt = Date.now();
  const res = await fetch(`${BASE}/api/apps/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok || !res.body) {
    return { ok: false, ms: Date.now() - startedAt, error: `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let attempts = 0;
  let fallbackNote;
  let error;
  let name;
  let issues = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data:')) continue;
      let evt;
      try {
        evt = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.t === 'saved') {
        attempts = evt.attempts ?? 1;
        name = evt.name;
        fallbackNote = evt.fallbackNote;
      }
      if (evt.t === 'issue') issues += 1;
      if (evt.t === 'error') error = String(evt.message).slice(0, 80);
    }
  }

  return {
    ok: Boolean(name) && !error,
    name,
    attempts,
    ms: Date.now() - startedAt,
    fallback: Boolean(fallbackNote),
    error,
    issues,
  };
}

const n = Number(process.argv[2] ?? PROMPTS.length);
const rows = [];
for (let i = 0; i < Math.min(n, PROMPTS.length); i++) {
  const r = await runOne(PROMPTS[i]);
  rows.push(r);
  const status = !r.ok ? '失败' : r.fallback ? '降级' : r.attempts > 1 ? '重试后成功' : '一次通过';
  console.log(
    `${String(i + 1).padStart(2)}. ${status.padEnd(6)} ${String(r.ms).padStart(5)}ms  ` +
      `${(r.name ?? '-').padEnd(10)} ${r.attempts ? `attempts=${r.attempts}` : ''} ${r.error ?? ''}`,
  );
}

const okCount = rows.filter((r) => r.ok && !r.fallback).length;
const firstTry = rows.filter((r) => r.ok && !r.fallback && r.attempts === 1).length;
const degraded = rows.filter((r) => r.fallback).length;
const failed = rows.filter((r) => !r.ok).length;
const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);

console.log('\n--- 汇总 ---');
console.log(`样本           ${rows.length}`);
console.log(`一次通过       ${firstTry}（${((firstTry / rows.length) * 100).toFixed(0)}%）`);
console.log(`含重试后通过   ${okCount}（${((okCount / rows.length) * 100).toFixed(0)}%）`);
console.log(`降级为模板     ${degraded}`);
console.log(`失败           ${failed}`);
console.log(`平均耗时       ${avg}ms`);
