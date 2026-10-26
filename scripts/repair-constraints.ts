/**
 * 一次性数据修补：给「老应用」补上数值下限约束。
 *
 * 背景（缺陷 16）：`applyConstraintHints` 只在生成和改需求链路里跑。
 * 之前生成的应用，其 spec 里的金额字段本来就没有 `min`，
 * 服务端按 spec 校验 → 0 元记录依然合法，于是分享页还能写进 0。
 * 这是数据缺口，不是校验逻辑错，所以要用一次性脚本把已有应用补齐。
 *
 * 语义：
 *   1. 遍历 apps 全表，取 apps.prompt（原生需求原文）与当前版本 spec；
 *   2. 调 applyConstraintHints(spec, prompt)（纯函数，返回新对象）；
 *   3. 有变化才 bumpVersion 生成新版本，不直接改历史版本（保持"版本不可变"）；
 *   4. 幂等：字段已有 min 时 changed 为空，第二次运行「修补 0 个」。
 *
 * 运行：npx tsx scripts/repair-constraints.ts
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { appVersions, apps } from '../src/lib/db/schema';
import { applyConstraintHints } from '../src/lib/agent/pipeline';
import { bumpVersion } from '../src/lib/data';
import type { AppSpec } from '../src/lib/spec/schema';

async function main() {
  const rows = await db.select().from(apps).orderBy(apps.createdAt);
  console.log(`开始扫描 ${rows.length} 个应用的下限约束…\n`);

  let repaired = 0;
  let skipped = 0;

  for (const app of rows) {
    const [version] = await db
      .select()
      .from(appVersions)
      .where(and(eq(appVersions.appId, app.id), eq(appVersions.version, app.currentVersion)))
      .limit(1);

    if (!version) {
      console.log(`- ${app.name}：缺少 v${app.currentVersion} 快照，跳过`);
      skipped += 1;
      continue;
    }

    const spec = version.spec as AppSpec;
    const prompt = app.prompt ?? '';
    const hinted = applyConstraintHints(spec, prompt);
    const changed = JSON.stringify(hinted.spec) !== JSON.stringify(spec);

    if (!changed || hinted.changed.length === 0) {
      console.log(`- ${app.name}（v${app.currentVersion}）：无需修补`);
      continue;
    }

    const versionNo = await bumpVersion({
      appId: app.id,
      spec: hinted.spec,
      patch: null,
      note: '按原始需求补充数值下限约束',
    });

    repaired += 1;
    console.log(
      `✓ ${app.name}（v${app.currentVersion} → v${versionNo}）：补 ${hinted.changed.join('、')}`,
    );
  }

  console.log(`\n扫描 ${rows.length} 个，修补 ${repaired} 个${skipped > 0 ? `，跳过 ${skipped} 个` : ''}。`);
  if (repaired > 0) {
    console.log('提示：修补会生成新版本，旧版本保留，可在应用页「版本」菜单里回滚。');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('修补失败：', err);
  process.exit(1);
});
