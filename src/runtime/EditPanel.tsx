'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type VersionInfo = { version: number; note: string | null; ops: number };

const SUGGESTIONS = [
  '把巡检得分改成必填',
  '加一个字段：整改负责人',
  '列表里加上区域列',
  '加一张平均分卡片',
];

export function EditPanel({
  appId,
  currentVersion,
  versions,
}: {
  appId: string;
  currentVersion: number;
  versions: VersionInfo[];
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(instruction: string) {
    const text = instruction.trim();
    if (pending || text.length < 2) return;
    setPending(true);
    setError(null);
    setIssues([]);
    setLogs([`指令：${text}`]);

    try {
      const res = await fetch(`/api/apps/${appId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: text }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `服务返回 ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          handle(evt);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  function handle(evt: Record<string, unknown>) {
    const t = evt.t as string;
    if (t === 'patch') {
      const ops = (evt.patch as unknown[]) ?? [];
      setLogs((prev) => [...prev, `生成 ${ops.length} 条补丁（${String(evt.model)}）`]);
      if (evt.note) setLogs((prev) => [...prev, String(evt.note)]);
      if (evt.fallbackNote) setLogs((prev) => [...prev, `⚠ ${String(evt.fallbackNote)}`]);
    } else if (t === 'warn') {
      setError(`部分补丁被拒绝：${String(evt.reason)}`);
    } else if (t === 'done') {
      if (evt.degraded) {
        setError(String(evt.note ?? '没有识别出可执行的修改'));
      } else {
        setLogs((prev) => [
          ...prev,
          `已生成 v${String(evt.versionNo)}：应用 ${String(evt.appliedOps)} 处，丢弃 ${String(evt.droppedOps)} 处`,
        ]);
        setInput('');
        router.refresh();
      }
    } else if (t === 'error') {
      setError(String(evt.message));
      const list = (evt.issues as Array<{ code: string; path: string; message: string }>) ?? [];
      setIssues(list.map((i) => `[${i.code}] ${i.path}: ${i.message}`));
    }
  }

  return (
    <div className="card mt-6 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-ink-900">用一句话改这个应用</h3>
          <p className="mt-0.5 text-[11px] text-ink-300">
            只输出 JSON Patch，改动落到 v{currentVersion + 1}，历史版本可回滚
          </p>
        </div>
        <VersionMenu appId={appId} currentVersion={currentVersion} versions={versions} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="input"
          placeholder="例如：把巡检得分改成必填"
          value={input}
          disabled={pending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(input);
          }}
        />
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={pending || input.trim().length < 2}
          onClick={() => submit(input)}
        >
          {pending ? '修改中…' : '提交修改'}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chip hover:border-brand-500 hover:text-brand-600"
            disabled={pending}
            onClick={() => submit(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-bad-600/20 bg-bad-50 px-3 py-2 text-[12px] text-bad-600">
          {error}
          {issues.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {issues.map((i, idx) => (
                <li key={idx} className="text-[11px]">
                  {i}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {logs.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-ink-100 pt-2">
          {logs.map((l, i) => (
            <li key={i} className="text-[11px] text-ink-500">
              · {l}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VersionMenu({
  appId,
  currentVersion,
  versions,
}: {
  appId: string;
  currentVersion: number;
  versions: VersionInfo[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function rollback(target: number) {
    setBusy(target);
    setMsg(null);
    try {
      const res = await fetch(`/api/apps/${appId}/versions/${target}/rollback`, { method: 'POST' });
      const data = (await res.json()) as { error?: string; versionNo?: number };
      if (!res.ok) throw new Error(data.error ?? `回滚失败 ${res.status}`);
      setMsg(`已回滚：当前为 v${data.versionNo}（内容来自 v${target}）`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn-ghost !py-1.5" onClick={() => setOpen((v) => !v)}>
        版本 v{currentVersion}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[300px] rounded-lg border border-ink-100 bg-white p-2 shadow-lg">
          <p className="px-2 py-1 text-[11px] text-ink-300">
            回滚 = 把旧版本复制成新版本，不删历史
          </p>
          <ul className="max-h-[240px] overflow-auto">
            {versions.map((v) => (
              <li
                key={v.version}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-ink-50"
              >
                <div className="min-w-0">
                  <span className="text-[12px] text-ink-900">v{v.version}</span>
                  <span className="ml-2 text-[11px] text-ink-500">{v.note ?? '—'}</span>
                </div>
                {v.version === currentVersion ? (
                  <span className="chip shrink-0">当前</span>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-brand-600 hover:underline"
                    disabled={busy !== null}
                    onClick={() => rollback(v.version)}
                  >
                    {busy === v.version ? '回滚中…' : '回滚'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {msg ? <p className="px-2 py-1 text-[11px] text-ink-500">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
