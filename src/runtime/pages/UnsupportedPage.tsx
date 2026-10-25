'use client';

import type { Page } from '@/lib/spec/schema';

type Props = { page: Page };

/** chart / board 属于 P1（见 docs/00 第七节裁决），此处明确降级而非白屏 */
export function UnsupportedPage({ page }: Props) {
  return (
    <div>
      <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
      <div className="mt-4 rounded-lg border border-warn-600/20 bg-warn-50 px-4 py-6 text-[13px] text-warn-600">
        页面类型 <code className="rounded bg-white px-1">{page.type}</code> 属于 P1 能力，当前版本先降级展示。
        它的数据仍在「列表 / 统计」页可见。
      </div>
    </div>
  );
}
