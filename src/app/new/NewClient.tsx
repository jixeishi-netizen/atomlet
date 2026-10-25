'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type StepState = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
};

const STEPS: StepState[] = [
  { id: 'plan', label: '理解需求并规划结构', status: 'pending' },
  { id: 'build', label: '生成应用声明（AppSpec）', status: 'pending' },
  { id: 'critic', label: '校验结构完整性', status: 'pending' },
];

type SavedEvent = {
  appId: string;
  shareToken: string;
  name: string;
  attempts: number;
  fallbackNote?: string;
};

export function NewClient({
  initialPrompt,
  channel,
}: {
  initialPrompt: string;
  channel: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [csv, setCsv] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [steps, setSteps] = useState<StepState[]>(STEPS);
  const [log, setLog] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedEvent | null>(null);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError('当前版本先支持 CSV：请在 Excel 里「另存为 → CSV」，再上传（xlsx 解析属 P1）');
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setError(null);
  }

  async function submit() {
    if (running) return;
    if (prompt.trim().length < 2 && !csv) {
      setError('请至少描述一句需求，或上传一份表格');
      return;
    }
    setRunning(true);
    setError(null);
    setIssues([]);
    setLog([]);
    setSaved(null);
    setSteps(STEPS.map((s) => ({ ...s, status: 'pending', detail: undefined })));

    try {
      const res = await fetch('/api/apps/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, csv }),
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
          const payload = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          handleEvent(payload);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(evt: Record<string, unknown>) {
    const t = evt.t as string;
    if (t === 'step') {
      setSteps((prev) =>
        prev.map((s) =>
          s.id === evt.id
            ? {
                ...s,
                status: evt.status as StepState['status'],
                detail: (evt.detail as string | undefined) ?? s.detail,
              }
            : s,
        ),
      );
    } else if (t === 'text') {
      setLog((prev) => [...prev, String(evt.text)]);
    } else if (t === 'issue') {
      const list = (evt.issues as Array<{ code: string; path: string; message: string }>) ?? [];
      setIssues(list.map((i) => `[${i.code}] ${i.path}: ${i.message}`));
    } else if (t === 'saved') {
      const info = evt as unknown as SavedEvent;
      setSaved(info);
      router.push(`/apps/${info.appId}`);
    } else if (t === 'error') {
      setError(String(evt.message));
    }
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="card p-5">
        <label className="label" htmlFor="prompt">
          业务需求
        </label>
        <textarea
          id="prompt"
          className="input min-h-[120px] resize-y"
          placeholder="例如：我要做一个门店巡检登记，记录门店、区域、巡检日期、得分、是否整改"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
        />

        <div className="mt-4 rounded-lg border border-dashed border-ink-100 bg-ink-50/40 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] text-ink-700">
                {fileName ? `已读取：${fileName}` : '上传表格（可选）'}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                按表头推断字段与类型，≤ 8 列效果最好。仅支持 CSV。
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost shrink-0"
              disabled={running}
              onClick={() => fileRef.current?.click()}
            >
              选择文件
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-bad-600/20 bg-bad-50 px-3 py-2 text-[12px] text-bad-600">
            {error}
          </div>
        ) : null}

        <button type="button" className="btn-primary mt-4 w-full" disabled={running} onClick={submit}>
          {running ? '生成中…' : '开始生成'}
        </button>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-300">
          当前模型通道：{channel}。在 .env 里把 LLM_PROVIDER 改成 openai 并填入 key，即可切到真实模型，链路不变。
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-ink-900">生成过程</h2>
          {running ? <span className="chip">进行中</span> : null}
        </div>

        <ol className="mt-4 space-y-3">
          {steps.map((step) => (
            <li key={step.id} className="flex gap-3">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                  step.status === 'done'
                    ? 'border-ok-600 bg-ok-50 text-ok-600'
                    : step.status === 'running'
                      ? 'animate-pulse border-brand-500 bg-brand-50 text-brand-600'
                      : step.status === 'failed'
                        ? 'border-bad-600 bg-bad-50 text-bad-600'
                        : 'border-ink-100 bg-white text-ink-300'
                }`}
              >
                {step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : '·'}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-ink-900">{step.label}</p>
                {step.detail ? <p className="text-[11px] text-ink-500">{step.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>

        {log.length > 0 ? (
          <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
            {log.map((line, i) => (
              <p key={i} className="text-[12px] leading-relaxed text-ink-500">
                · {line}
              </p>
            ))}
          </div>
        ) : null}

        {issues.length > 0 ? (
          <div className="mt-4 rounded-md border border-warn-600/20 bg-warn-50 px-3 py-2">
            <p className="text-[12px] font-medium text-warn-600">校验问题（已回灌重试）</p>
            <ul className="mt-1 space-y-1">
              {issues.map((i, idx) => (
                <li key={idx} className="text-[11px] text-warn-600">
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {saved ? (
          <div className="mt-4 space-y-1 rounded-md border border-ok-600/20 bg-ok-50 px-3 py-2 text-[12px] text-ok-600">
            <p>
              已生成「{saved.name}」，尝试 {saved.attempts} 次。
            </p>
            {saved.fallbackNote ? (
              <p className="text-[11px] text-warn-600">⚠ {saved.fallbackNote}</p>
            ) : null}
          </div>
        ) : null}

        {!running && log.length === 0 && !error ? (
          <p className="mt-6 text-[12px] leading-relaxed text-ink-300">
            生成分三步：规划（确定实体与字段）→ 构建（产出 AppSpec JSON）→ 校验（结构 + 引用完整性 + 可渲染性）。
            校验不通过会带着错误回灌重试，最多 3 次。
          </p>
        ) : null}
      </div>
    </div>
  );
}
