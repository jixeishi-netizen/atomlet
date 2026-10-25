import Link from 'next/link';
import { NewClient } from './NewClient';

export const dynamic = 'force-dynamic';

export default function NewPage({
  searchParams,
}: {
  searchParams: { prompt?: string };
}) {
  const channel =
    process.env.LLM_PROVIDER === 'openai' && process.env.LLM_API_KEY
      ? `真实模型 ${process.env.LLM_MODEL ?? ''}`
      : 'mock（本地确定性生成，无需 key）';
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium text-ink-900">新建应用</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            描述一句业务需求，或上传一份 CSV 表格。智能体会先规划结构，再生成声明，最后自检。
          </p>
        </div>
        <Link href="/" className="btn-ghost">
          返回工作台
        </Link>
      </div>

      <NewClient initialPrompt={searchParams.prompt ?? ''} channel={channel} />
    </main>
  );
}
