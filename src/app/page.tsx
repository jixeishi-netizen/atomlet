import Link from 'next/link';
import { listApps } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  { label: '门店巡检', text: '我要做一个门店巡检登记，记录门店、区域、巡检日期、得分、是否整改' },
  { label: '费用报销', text: '做一个员工费用报销登记，包含部门、金额、费用类型、发票号和是否打款' },
  { label: '客户线索', text: '销售线索登记，记录公司、联系人、电话、跟进阶段和预估金额' },
];

export default async function HomePage() {
  let apps: Awaited<ReturnType<typeof listApps>> = [];
  let dbError: string | null = null;
  try {
    apps = await listApps();
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium text-ink-900">工作台</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            上传一张表格，或说一句业务痛点，生成一套能用的系统。
          </p>
        </div>
        <Link href="/new" className="btn-primary">
          新建应用
        </Link>
      </div>

      {dbError ? (
        <div className="mt-6 rounded-lg border border-bad-600/20 bg-bad-50 px-4 py-3 text-[13px] text-bad-600">
          数据库未就绪：{dbError}
          <div className="mt-1 text-[12px] text-ink-500">
            先执行 <code className="rounded bg-white px-1">docker compose -f docker-compose.dev.yml up -d</code>
            ，再跑 <code className="rounded bg-white px-1">npm run db:push</code>。
          </div>
        </div>
      ) : null}

      {apps.length === 0 && !dbError ? (
        <div className="mt-6">
          <div className="card border-dashed p-10 text-center">
            <p className="text-[14px] text-ink-700">还没有应用</p>
            <p className="mt-1 text-[12px] text-ink-500">
              从下面挑一个场景试试，或者直接去新建页上传一张表格。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Link
                  key={s.label}
                  href={`/new?prompt=${encodeURIComponent(s.text)}`}
                  className="btn-ghost"
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Link
              key={app.id}
              href={`/apps/${app.id}`}
              className="card group px-4 py-3.5 transition-colors hover:border-brand-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[14px] font-medium text-ink-900 group-hover:text-brand-600">
                    {app.name}
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[32px] text-[12px] text-ink-500">
                    {app.description ?? '—'}
                  </p>
                </div>
                <span className="chip shrink-0">v{app.currentVersion}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-ink-300">
                <span>{formatDateTime(app.createdAt)}</span>
                <span className="text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                  打开 →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
