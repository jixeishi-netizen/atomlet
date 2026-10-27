/**
 * 2048 引擎：纯函数，不依赖 DOM，便于单测与在渲染器里复用。
 * 规则：4×4 棋盘，同值相邻合并一次，合并后的方块本回合不再参与合并。
 */

export type Board = number[][];
export type Dir = 'up' | 'down' | 'left' | 'right';

export const SIZE = 4;

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function spawnTile(
  board: Board,
  random: () => number = Math.random,
): { board: Board; spawned: boolean } {
  const empties: Array<[number, number]> = [];
  board.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === 0) empties.push([r, c]);
    }),
  );
  if (empties.length === 0) return { board, spawned: false };
  const [r, c] = empties[Math.floor(random() * empties.length)];
  const next = cloneBoard(board);
  next[r][c] = random() < 0.9 ? 2 : 4;
  return { board: next, spawned: true };
}

export function startBoard(random: () => number = Math.random): Board {
  return spawnTile(spawnTile(emptyBoard(), random).board, random).board;
}

function slideLine(line: number[]): { line: number[]; gained: number; moved: boolean } {
  const tiles = line.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;

  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      const merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // 合并后的方块不再参与本回合合并
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < SIZE) out.push(0);

  const moved = out.some((v, idx) => v !== line[idx]);
  return { line: out, gained, moved };
}

function transpose(board: Board): Board {
  return board[0].map((_, c) => board.map((row) => row[c]));
}

function reverseRows(board: Board): Board {
  return board.map((row) => [...row].reverse());
}

export function move(
  board: Board,
  dir: Dir,
): { board: Board; moved: boolean; gained: number } {
  let working: Board;

  switch (dir) {
    case 'left':
      working = board;
      break;
    case 'right':
      working = reverseRows(board);
      break;
    case 'up':
      working = transpose(board);
      break;
    case 'down':
      working = reverseRows(transpose(board));
      break;
  }

  let moved = false;
  let gained = 0;
  const next = working.map((row) => {
    const r = slideLine(row);
    if (r.moved) moved = true;
    gained += r.gained;
    return r.line;
  });

  let result: Board =
    dir === 'left'
      ? next
      : dir === 'right'
        ? reverseRows(next)
        : dir === 'up'
          ? transpose(next)
          : transpose(reverseRows(next));

  result = result.map((row) => [...row]);
  return { board: result, moved, gained };
}

export function hasWon(board: Board, target = 2048): boolean {
  return board.some((row) => row.some((v) => v >= target));
}

export function isGameOver(board: Board): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) return false;
      if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return false;
      if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return false;
    }
  }
  return true;
}

// ---------- 从 localStorage 读写最高分（按应用隔离） ----------

const BEST_KEY = (appId: string) => `atomlet:2048:best:${appId}`;

export function loadBest(appId: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(BEST_KEY(appId));
  const num = raw ? Number(raw) : 0;
  return Number.isFinite(num) ? num : 0;
}

export function saveBest(appId: string, score: number): void {
  if (typeof window === 'undefined') return;
  const best = loadBest(appId);
  if (score > best) window.localStorage.setItem(BEST_KEY(appId), String(score));
}
