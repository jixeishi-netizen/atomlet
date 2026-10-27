'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AppSpec, Page } from '@/lib/spec/schema';
import { themeName, themeStyle } from '@/lib/theme';
import type { Row, RowsByEntity } from './types';
import type { MessageView } from './EditPanel';
import { FormPage } from './pages/FormPage';
import { TablePage } from './pages/TablePage';
import { StatsPage } from './pages/StatsPage';
import { DetailPage } from './pages/DetailPage';
import { UnsupportedPage } from './pages/UnsupportedPage';
import { GamePage } from './pages/GamePage';
import { EditPanel } from './EditPanel';

type Props = {
  appInfo: {
    id: string;
    name: string;
    description?: string | null;
    icon: string;
    version: number;
  };
  spec: AppSpec;
  rowsByEntity: RowsByEntity;
  mode: 'owner' | 'public';
  submitUrl: string;
  sharePath?: string;
  versions?: Array<{ version: number; note: string | null; ops: number }>;
  messages?: MessageView[];
};

export function AppRenderer({
  appInfo,
  spec,
  rowsByEntity,
  mode,
  submitUrl,
  sharePath,
  versions = [],
  messages = [],
}: Props) {
  const router = useRouter();

  const pages = useMemo<Page[]>(() => {
    if (mode === 'public') {
      return spec.pages.filter((p) => {
        if (p.type === 'game') return true; // 交互页无需数据，可直接分享
        return p.type === 'form' && spec.sharePolicy.entities.includes(p.entity);
      });
    }
    return spec.pages;
  }, [mode, spec]);

  const defaultId = useMemo(() => {
    if (mode === 'public') return pages[0]?.id;
    const table = pages.find((p) => p.type === 'table');
    return table?.id ?? pages[0]?.id;
  }, [mode, pages]);

  const [activeId, setActiveId] = useState<string | undefined>(defaultId);
  const [selected, setSelected] = useState<Row | undefined>();
  const active = pages.find((p) => p.id === activeId) ?? pages[0];

  if (!active) {
    return (
      <div className="card p-6 text-[13px] text-ink-500">
        这个应用没有可展示的页面。
      </div>
    );
  }

  const entity =
    active.type === 'game' ? undefined : spec.entities.find((e) => e.key === active.entity);
  const rows = entity ? (rowsByEntity[entity.key] ?? []) : [];
  const theme = spec.app.theme;

  return (
    // data-theme + 内联 CSS 变量：主题真正作用到 DOM（缺陷 2，可在 DevTools 里核对 --brand-600）
    <div
      data-theme={theme}
      style={themeStyle(theme)}
      className="rounded-xl bg-[var(--canvas)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-medium text-ink-900">{appInfo.name}</h1>
            <span className="chip !border-ink-100 !bg-[var(--brand-50)] !text-[var(--brand-600)]">
              v{appInfo.version}
            </span>
            <span className="text-[11px] text-ink-300">主题：{themeName[theme]}</span>
            {mode === 'public' ? (
              <span className="chip !border-ok-600/30 !bg-ok-50 !text-ok-600">外部填报</span>
            ) : null}
          </div>
          {appInfo.description ? (
            <p className="mt-1 max-w-2xl text-[12px] text-ink-500">{appInfo.description}</p>
          ) : null}
        </div>

        {mode === 'owner' && sharePath ? <ShareBox path={sharePath} /> : null}
      </div>

      {pages.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setActiveId(p.id);
                if (p.type !== 'detail') setSelected(undefined);
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                p.id === active.id
                  ? 'bg-[var(--brand-600)] text-white'
                  : 'border border-ink-100 bg-white text-ink-700 hover:border-[var(--brand-500)]'
              }`}
            >
              {p.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5">
        {active.type === 'game' ? (
          <GamePage page={active} appId={appInfo.id} />
        ) : !entity ? (
          <div className="card p-6 text-[13px] text-bad-600">
            页面引用的实体「{active.entity}」不存在，这是 AppSpec 校验未拦住的情况。
          </div>
        ) : active.type === 'form' ? (
          <FormPage
            entity={entity}
            page={active}
            submitUrl={submitUrl}
            onSubmitted={() => router.refresh()}
          />
        ) : active.type === 'table' ? (
          <TablePage
            entity={entity}
            page={active}
            rows={rows}
            onRowClick={(row) => {
              setSelected(row);
              const detail = pages.find((p) => p.type === 'detail');
              if (detail) setActiveId(detail.id);
            }}
          />
        ) : active.type === 'stats' ? (
          <StatsPage entity={entity} page={active} rows={rows} />
        ) : active.type === 'detail' ? (
          <DetailPage
            entity={entity}
            page={active}
            record={selected}
            onBack={() => {
              const table = pages.find((p) => p.type === 'table');
              if (table) setActiveId(table.id);
            }}
          />
        ) : (
          <UnsupportedPage page={active} />
        )}
      </div>

      {mode === 'owner' ? (
        <EditPanel
          appId={appInfo.id}
          currentVersion={appInfo.version}
          versions={versions}
          messages={messages}
        />
      ) : null}
    </div>
  );
}

function ShareBox({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

  return (
    <div className="relative">
      <button type="button" className="btn-ghost" onClick={() => setOpen((v) => !v)}>
        分享填报链接
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[320px] rounded-lg border border-ink-100 bg-white p-3 shadow-lg">
          <p className="text-[12px] text-ink-500">
            把链接发给同事，他们无需登录即可填报，数据直接进同一个库。
          </p>
          <div className="mt-2 flex gap-2">
            <input readOnly className="input !py-1.5 text-[11px]" value={url} />
            <button
              type="button"
              className="btn-primary !py-1.5 whitespace-nowrap"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                } catch {
                  /* 剪贴板不可用时静默降级，用户可手动全选复制 */
                }
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <a
            href={path}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[12px] text-[var(--brand-600)] hover:underline"
          >
            在新窗口打开填报页 →
          </a>
        </div>
      ) : null}
    </div>
  );
}
