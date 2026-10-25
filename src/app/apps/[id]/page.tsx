import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppRenderer } from '@/runtime/AppRenderer';
import type { RowsByEntity } from '@/runtime/types';
import { getApp, getCurrentSpec, getRecordsByEntity, getShareLink, listVersions } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function AppPage({ params }: { params: { id: string } }) {
  const app = await getApp(params.id);
  if (!app) notFound();

  const spec = await getCurrentSpec(app.id, app.currentVersion);
  if (!spec) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-10">
        <div className="card p-6 text-[13px] text-bad-600">
          这个应用缺少版本快照（app_versions 里没有 v{app.currentVersion}），数据不完整。
        </div>
      </main>
    );
  }

  const entityKeys = spec.entities.map((e) => e.key);
  const raw = await getRecordsByEntity(app.id, entityKeys);
  const rowsByEntity: RowsByEntity = {};
  for (const key of entityKeys) {
    rowsByEntity[key] = (raw[key] ?? []).map((r) => ({
      id: r.id,
      entity: r.entity,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  const link = await getShareLink(app.id);
  const versionRows = await listVersions(app.id);
  const versions = versionRows.map((v) => ({
    version: v.version,
    note: v.note,
    ops: Array.isArray(v.patch) ? v.patch.length : 0,
  }));

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <div className="mb-4 flex items-center gap-2 text-[12px] text-ink-300">
        <Link href="/" className="hover:text-ink-700">
          工作台
        </Link>
        <span>/</span>
        <span className="text-ink-500">{app.name}</span>
      </div>

      <AppRenderer
        appInfo={{
          id: app.id,
          name: app.name,
          description: app.description,
          icon: app.icon,
          version: app.currentVersion,
        }}
        spec={spec}
        rowsByEntity={rowsByEntity}
        mode="owner"
        submitUrl={`/api/apps/${app.id}/records`}
        sharePath={link ? `/p/${link.token}` : undefined}
        versions={versions}
      />

      <p className="mt-8 text-[11px] leading-relaxed text-ink-300">
        这个页面的结构完全来自 AppSpec（版本 v{app.currentVersion}）：换一份 spec 就换一套应用，
        渲染器代码不用改。数据存在统一 app_records 表，用 app_id 隔离。
      </p>
    </main>
  );
}
