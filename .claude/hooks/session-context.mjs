// SessionStart / UserPromptSubmit: 現在の状態を数行だけ注入する（コンテキストを汚さない）
import { readInput } from './_io.mjs';
import { findRoot } from '../../scripts/lib/util.mjs';
import { statusLines } from '../../scripts/lib/statusview.mjs';

const input = await readInput();
try {
  const root = findRoot(input.cwd || process.cwd()) || process.env.CLAUDE_PROJECT_DIR;
  if (root) process.stdout.write(statusLines(root, { brief: true }).join('\n') + '\n');
} catch {
  /* 状態表示の失敗で作業を止めない */
}
process.exit(0);
