import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Atomlet · 把一张表格长成一个系统',
  description: '多智能体驱动的内部小工具生成器：上传表格或一句话，生成可用的录入、列表、统计应用。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-[13px] font-medium text-white">
                A
              </span>
              <span className="text-[14px] font-medium text-ink-900">Atomlet</span>
              <span className="hidden text-[12px] text-ink-300 sm:inline">
                把一张表格，长成一个系统
              </span>
            </Link>
            <nav className="flex items-center gap-3 text-[13px] text-ink-500">
              <Link href="/" className="hover:text-ink-900">
                工作台
              </Link>
              <Link href="/new" className="btn-primary !py-1.5">
                新建应用
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
