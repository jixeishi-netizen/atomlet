import { appendMessage, bumpVersion, getApp, getVersion } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * 回滚语义：不删除历史，把目标版本的 spec 复制成新版本（见 docs/08 §5.6、docs/15 §8）。
 * 因此"回滚"本身也可回滚。
 */
export async function POST(_req: Request, { params }: { params: { id: string; vid: string } }) {
  const app = await getApp(params.id);
  if (!app) return Response.json({ error: '应用不存在', code: 'NOT_FOUND' }, { status: 404 });

  const targetVersion = Number(params.vid);
  if (!Number.isInteger(targetVersion)) {
    return Response.json({ error: '版本号非法', code: 'NOT_FOUND' }, { status: 404 });
  }

  const target = await getVersion(app.id, targetVersion);
  if (!target) {
    return Response.json({ error: '目标版本不属于该应用', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (target.version === app.currentVersion) {
    return Response.json(
      { error: '当前已在该版本，无需回滚', code: 'CONFLICT' },
      { status: 409 },
    );
  }

  const versionNo = await bumpVersion({
    appId: app.id,
    spec: target.spec,
    patch: null,
    note: `回滚到 v${target.version}`,
  });

  await appendMessage({
    appId: app.id,
    role: 'assistant',
    content: `已回滚到 v${target.version}，当前版本 v${versionNo}（旧版本仍保留）。`,
    version: versionNo,
    meta: {
      kind: 'rollback',
      note: `回滚到 v${target.version}`,
      instructions: [`from v${app.currentVersion}`, `to v${target.version}`],
    },
  });

  return Response.json({
    versionNo,
    rolledBackFrom: app.currentVersion,
    rolledBackTo: target.version,
  });
}
