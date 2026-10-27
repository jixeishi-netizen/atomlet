'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '@/lib/spec/schema';
import {
  isGameOver,
  hasWon,
  loadBest,
  move,
  saveBest,
  spawnTile,
  startBoard,
  type Board,
  type Dir,
} from '@/lib/games/2048';

type GamePageSpec = Extract<Page, { type: 'game' }>;

const TILE_STYLE: Record<number, { bg: string; color: string; size: string }> = {
  2: { bg: '#EEE4DA', color: '#776E65', size: 'text-[26px]' },
  4: { bg: '#EDE0C8', color: '#776E65', size: 'text-[26px]' },
  8: { bg: '#F2B179', color: '#FFFFFF', size: 'text-[26px]' },
  16: { bg: '#F59563', color: '#FFFFFF', size: 'text-[24px]' },
  32: { bg: '#F67C5F', color: '#FFFFFF', size: 'text-[24px]' },
  64: { bg: '#F65E3B', color: '#FFFFFF', size: 'text-[24px]' },
  128: { bg: '#EDCF72', color: '#FFFFFF', size: 'text-[20px]' },
  256: { bg: '#EDCC61', color: '#FFFFFF', size: 'text-[20px]' },
  512: { bg: '#EDC850', color: '#FFFFFF', size: 'text-[20px]' },
  1024: { bg: '#EDC53F', color: '#FFFFFF', size: 'text-[16px]' },
  2048: { bg: '#EDC22E', color: '#FFFFFF', size: 'text-[16px]' },
};

export function GamePage({ page, appId }: { page: GamePageSpec; appId: string }) {
  if (page.game === 'custom') {
    return <CustomGamePage page={page} appId={appId} />;
  }
  return <Builtin2048 page={page} appId={appId} />;
}

/**
 * 模型生成的单文件游戏：跑在沙箱 iframe 里。
 * sandbox 不给 allow-same-origin —— 脚本拿不到父页面、Cookie 与 localStorage，
 * 即使生成的代码有问题也污染不到宿主应用。
 */
function CustomGamePage({ page, appId }: { page: GamePageSpec; appId: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 生成页通过 postMessage 请求落库：{ type: 'atomlet:save', data: {...} }
  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { type?: string; data?: unknown };
      if (!payload || payload.type !== 'atomlet:save') return;
      if (!payload.data || typeof payload.data !== 'object') return;

      try {
        const res = await fetch(`/api/apps/${appId}/interactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload.data }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `保存失败 ${res.status}`);
        }
        setSaveError(null);
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      } catch (err) {
        setSaveError((err as Error).message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appId]);

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
          <p className="mt-1 text-[12px] text-ink-500">
            {page.intro ?? '点击画面后使用键盘，或在触屏上操作'}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0 !py-1.5"
          onClick={() => {
            const frame = frameRef.current;
            if (frame) frame.srcdoc = page.html ?? '';
          }}
        >
          重新加载
        </button>
      </div>

      {savedAt || saveError ? (
        <div
          className={`mt-2 rounded-md px-3 py-1.5 text-[12px] ${
            saveError
              ? 'border border-bad-600/20 bg-bad-50 text-bad-600'
              : 'border border-ok-600/20 bg-ok-50 text-ok-600'
          }`}
        >
          {saveError ? `保存失败：${saveError}` : `成绩已存入数据库（${savedAt}）`}
        </div>
      ) : null}

      <iframe
        id={`game-${page.id}`}
        ref={frameRef}
        title={page.title}
        srcDoc={page.html}
        sandbox="allow-scripts allow-pointer-lock"
        className="mt-3 h-[560px] w-full rounded-lg border border-ink-100 bg-white"
      />
      <p className="mt-2 text-center text-[11px] text-ink-300">
        页面由模型生成，运行在沙箱中（无网络、无法访问父页面）；成绩通过消息通道写入数据库
      </p>
    </div>
  );
}

function Builtin2048({ page, appId }: { page: GamePageSpec; appId: string }) {
  const [board, setBoard] = useState<Board>(() => startBoard());
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [keepGoing, setKeepGoing] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setBest(loadBest(appId));
  }, [appId]);

  const reset = useCallback(() => {
    setBoard(startBoard());
    setScore(0);
    setOver(false);
    setWon(false);
    setKeepGoing(false);
  }, []);

  const applyMove = useCallback(
    (dir: Dir) => {
      if (over) return;
      const result = move(board, dir);
      if (!result.moved) return;

      const next = spawnTile(result.board).board;
      const nextScore = score + result.gained;

      setBoard(next);
      setScore(nextScore);
      saveBest(appId, nextScore);
      setBest((b) => Math.max(b, nextScore));

      if (!won && hasWon(next)) setWon(true);
      if (isGameOver(next)) setOver(true);
    },
    [appId, board, over, score, won],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      applyMove(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyMove]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) applyMove(dx > 0 ? 'right' : 'left');
    else applyMove(dy > 0 ? 'down' : 'up');
  }

  return (
    <div className="mx-auto max-w-[440px]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink-900">{page.title}</h2>
          <p className="mt-1 text-[12px] text-ink-500">
            {page.intro ?? '方向键 / WASD 移动，手机可滑动；相同数字相撞会合并'}
          </p>
        </div>
        <button type="button" className="btn-ghost shrink-0 !py-1.5" onClick={reset}>
          重新开始
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="flex-1 rounded-lg border border-ink-100 bg-white px-3 py-2">
          <div className="text-[11px] text-ink-500">当前分数</div>
          <div className="text-[20px] font-medium leading-tight text-ink-900">{score}</div>
        </div>
        <div className="flex-1 rounded-lg border border-ink-100 bg-white px-3 py-2">
          <div className="text-[11px] text-ink-500">最高分</div>
          <div className="text-[20px] font-medium leading-tight text-[var(--brand-600)]">{best}</div>
        </div>
      </div>

      <div
        className="relative mt-3 select-none rounded-lg bg-[#BBADA0] p-2"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="grid grid-cols-4 gap-2">
          {board.map((row, r) =>
            row.map((value, c) => {
              const style = TILE_STYLE[value];
              return (
                <div
                  key={`${r}-${c}`}
                  className="grid aspect-square place-items-center rounded-md font-medium transition-all"
                  style={{
                    backgroundColor: value === 0 ? 'rgba(238,228,218,0.35)' : style?.bg,
                    color: style?.color,
                    fontSize: value >= 128 ? 18 : 24,
                  }}
                >
                  {value === 0 ? '' : value}
                </div>
              );
            }),
          )}
        </div>

        {(over || (won && !keepGoing)) && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-[#EEE4DA]/92 px-4 text-center">
            <div>
              <div className="text-[18px] font-medium text-ink-900">
                {over ? '没有可移动的方块了' : '拼到 2048 了'}
              </div>
              <div className="mt-1 text-[12px] text-ink-500">本次得分 {score}</div>
              <div className="mt-3 flex justify-center gap-2">
                {won && !over ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setKeepGoing(true)}
                  >
                    继续挑战
                  </button>
                ) : null}
                <button type="button" className="btn-primary" onClick={reset}>
                  再来一局
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-[11px] text-ink-300">
        提示：分数保存在本机浏览器，不写入数据库
      </p>
    </div>
  );
}
