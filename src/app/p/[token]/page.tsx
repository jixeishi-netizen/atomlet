import { AppRenderer } from '@/runtime/AppRenderer';
import { getAppByToken } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function PublicFillPage({ params }: { params: { token: string } }) {
  const found = await getAppByToken(params.token).catch(() => null);

  if (!found) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <div className="card p-6 text-center">
          <p className="text-[15px] font-medium text-ink-900">链接无效或已过期</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
            这个填报链接可能已被撤销，或应用已被删除。请联系发链接的人重新生成。
          </p>
        </div>
      </main>
    );
  }

  const { app, spec, link } = found;

  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <AppRenderer
        appInfo={{
          id: app.id,
          name: app.name,
          description: spec.app.description,
          icon: app.icon,
          version: app.currentVersion,
        }}
        spec={spec}
        rowsByEntity={{}}
        mode="public"
        submitUrl={`/api/public/${link.token}/records`}
      />
      <p className="mt-8 text-center text-[11px] text-ink-300">
        由 Atomlet 生成 · 提交的数据直接写入发起人的数据库
      </p>
    </main>
  );
}
