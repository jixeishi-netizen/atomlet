import { getApp, getCurrentSpec, listVersions } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const app = await getApp(params.id);
  if (!app) return Response.json({ error: '应用不存在' }, { status: 404 });

  const rows = await listVersions(app.id);
  return Response.json({
    currentVersion: app.currentVersion,
    versions: rows.map((v) => ({
      id: v.id,
      version: v.version,
      note: v.note,
      ops: Array.isArray(v.patch) ? v.patch.length : 0,
      createdAt: v.createdAt,
    })),
  });
}
