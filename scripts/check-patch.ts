/**
 * patch 引擎自检：不依赖服务，直接跑库里的真实 spec。
 * 用途：演示前 30 秒确认"改不坏"的两道守门还在（docs/15 §5、§9）。
 *
 * 运行：npx tsx scripts/check-patch.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { apps, appVersions } from '../src/lib/db/schema';
import { applyPatch, validateAfterApply, type PatchOp } from '../src/lib/patch';
import type { AppSpec } from '../src/lib/spec/schema';

let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function main() {
  const [app] = await db.select().from(apps).where(eq(apps.name, '门店巡检')).limit(1);
  if (!app) {
    console.error('找不到「门店巡检」应用，先跑 npm run db:seed');
    process.exit(1);
  }
  const [version] = await db
    .select()
    .from(appVersions)
    .where(eq(appVersions.appId, app.id))
    .limit(1);
  const spec = version.spec as AppSpec;
  console.log(`基线：${app.name} v${version.version}，${spec.entities[0].fields.length} 字段 / ${spec.pages.length} 页面\n`);

  // 1) 越界路径：/specVersion 不可改
  const outOfScope: PatchOp[] = [
    { op: 'replace', path: '/specVersion', value: '9.9' },
    { op: 'replace', path: '/app/name', value: '改名成功' },
  ];
  const r1 = applyPatch(spec, outOfScope);
  check(
    '越界路径被丢弃、合规补丁仍生效',
    r1.dropped.length === 1 && r1.applied.length === 1 && r1.spec.app.name === '改名成功',
    `applied=${r1.applied.length} dropped=${r1.dropped.length}（${r1.dropped[0]?.reason.slice(0, 24)}…）`,
  );

  // 2) 原型污染
  const proto: PatchOp[] = [{ op: 'add', path: '/entities/0/__proto__/x', value: 1 }];
  const r2 = applyPatch(spec, proto);
  check('危险键名被拒绝', r2.dropped.length === 1 && r2.applied.length === 0, r2.dropped[0]?.reason ?? '');

  // 3) 路径不存在：只丢弃，不中断
  const missing: PatchOp[] = [
    { op: 'replace', path: '/pages/9/title', value: 'x' },
    { op: 'add', path: '/entities/0/fields/-', value: { key: 'tmpField', label: '临时', type: 'text' } },
  ];
  const r3 = applyPatch(spec, missing);
  check('路径不存在时仅丢弃该条', r3.dropped.length === 1 && r3.applied.length === 1, `dropped=${r3.dropped[0]?.reason ?? ''}`);

  // 4) 能通过结构校验，但会破坏引用完整性 → 必须被拦
  const areaIdx = spec.entities[0].fields.findIndex((f) => f.key === 'area');
  const broken: PatchOp[] = [{ op: 'remove', path: `/entities/0/fields/${areaIdx}` }];
  const r4 = applyPatch(spec, broken);
  const v4 = validateAfterApply(r4.spec);
  const codes = v4.ok ? [] : v4.issues.map((i) => i.code);
  check(
    '删除被列表引用的字段 → 校验拦下、不产生新版本',
    r4.applied.length === 1 && !v4.ok && codes.includes('PAGE_FIELD_MISSING'),
    v4.ok ? '竟然通过了' : codes.join(','),
  );

  // 5) 合法的改必填（用初始非必填的字段，避免断言假阳性）
  const issueIdx = spec.entities[0].fields.findIndex((f) => f.key === 'issue');
  check('基线里「发现问题」初始为非必填', spec.entities[0].fields[issueIdx].required !== true, 'issue.required≠true');
  const okPatch: PatchOp[] = [
    { op: 'replace', path: `/entities/0/fields/${issueIdx}/required`, value: true },
  ];
  const r5 = applyPatch(spec, okPatch);
  const v5 = validateAfterApply(r5.spec);
  check('合法补丁通过校验', r5.applied.length === 1 && v5.ok, 'issue.required=true');

  // 6) 原始 spec 未被污染（applyPatch 走深拷贝）
  const issueAfter = spec.entities[0].fields[issueIdx].required;
  check('原地对象未被修改', issueAfter !== true, `spec.issue.required=${String(issueAfter)}`);

  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
