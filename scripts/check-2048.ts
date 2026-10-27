/**
 * 2048 引擎自检：纯逻辑，不需要浏览器。
 * 运行：npx tsx scripts/check-2048.ts
 */
import { hasWon, isGameOver, move, startBoard, type Board } from '../src/lib/games/2048';

let fail = 0;

function eq(name: string, actual: unknown, expect: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expect);
  const ok = a === e;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n   got=${a}\n   want=${e}`}`);
  if (!ok) fail += 1;
}

const row = (values: number[]): Board => [values, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];

// 基础合并
eq('2,2 左移合并为 4', move(row([2, 2, 0, 0]), 'left').board[0], [4, 0, 0, 0]);
eq('合并得分 4', move(row([2, 2, 0, 0]), 'left').gained, 4);
eq('4,4,4,4 左移合并为 8,8', move(row([4, 4, 4, 4]), 'left').board[0], [8, 8, 0, 0]);
eq('合并得分 16', move(row([4, 4, 4, 4]), 'left').gained, 16);
eq('2,2,2 左移只合并一次 → 4,2', move(row([2, 2, 2, 0]), 'left').board[0], [4, 2, 0, 0]);

// 四个方向
eq('右移 2,2 → 0,0,0,4', move(row([2, 2, 0, 0]), 'right').board[0], [0, 0, 0, 4]);
const col: Board = [[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
eq('上移 2,2 合并', move(col, 'up').board.map((r) => r[0]), [4, 0, 0, 0]);
eq('下移 2,2 合并', move(col, 'down').board.map((r) => r[0]), [0, 0, 0, 4]);

// 无位移时不加新块（返回 moved=false 由 UI 判断）
eq('已贴边时左移不动', move(row([2, 4, 8, 16]), 'left').moved, false);
eq('中间有空格时左移会动', move(row([2, 0, 4, 0]), 'left').moved, true);

// 胜负判定
eq('出现 2048 判胜', hasWon([[2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), true);
const full: Board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
eq('满盘且无相邻相同 → 结束', isGameOver(full), true);
eq('满盘但有相邻相同 → 未结束', isGameOver([[2, 2, 4, 8], [4, 8, 16, 32], [2, 4, 8, 16], [4, 8, 16, 32]]), false);

// 开局
eq('开局恰好两块', startBoard().flat().filter((v) => v > 0).length, 2);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
