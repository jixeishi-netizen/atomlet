/**
 * 清库脚本：清空所有业务数据后重新灌种子。
 * 用途：演示前把环境恢复成干净状态（面试官会反复点，脏数据很难看）。
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';

async function main() {
  console.log('清空业务表…');
  await db.execute(
    sql`TRUNCATE TABLE messages, app_records, share_links, app_versions, gen_runs, apps RESTART IDENTITY CASCADE`,
  );
  console.log('已清空。接着执行 npm run db:seed 重新灌种子数据。');
  process.exit(0);
}

main().catch((err) => {
  console.error('清库失败：', err);
  process.exit(1);
});
