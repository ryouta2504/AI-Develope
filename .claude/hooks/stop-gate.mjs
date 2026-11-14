// Stop / SubagentStop
// - 実装中に src/ が変わっていれば test / lint / typecheck を実行し、失敗なら終了をブロックする
// - 人間の承認待ちなら、その旨を表示して停止を許可する
import fs from 'node:fs';
import path from 'node:path';
import { readInput } from './_io.mjs';
import { findRoot, hashTree, readJSON, writeJSON } from '../../scripts/lib/util.mjs';
import { deriveState, nextAction } from '../../scripts/lib/state.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';
import { runCommand, summarize } from '../../scripts/lib/run.mjs';

const input = await readInput();
const out = (obj) => {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
};

try {
  const root = findRoot(input.cwd || process.cwd()) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);
  const state = deriveState(root);
  const isSub = input.hook_event_name === 'SubagentStop';

  // サブエージェントは実装担当のときだけ検査する
  if (isSub && input.agent_type !== 'implementer') process.exit(0);

  if (!['implementation', 'ai_review'].includes(state.phase)) {
    if (!isSub && state.blockingStep?.kind === 'human') out({ systemMessage: `⏸ 人間の承認待ちです: ${nextAction(state)}` });
    process.exit(0);
  }

  const config = loadConfig(root);
  const cacheFile = path.join(root, '.ai-dev', '.cache', 'stop-gate.json');
  const cache = readJSON(cacheFile, {});
  const hash = `${hashTree(root, 'src')}:${hashTree(root, 'e2e')}`;
  if (hash.startsWith('EMPTY:')) process.exit(0);
  if (cache.hash === hash && cache.ok) process.exit(0);

  // 無限ループ防止: 連続ブロックが上限に達したら止めずに人間へ知らせる
  const blocks = cache.hash === hash ? cache.blocks || 0 : 0;
  if (input.stop_hook_active && blocks >= config.maxStopBlocks) {
    writeJSON(cacheFile, { hash, ok: false, blocks: 0 });
    out({ systemMessage: `⚠ 自動ゲートが ${config.maxStopBlocks} 回連続で失敗しました。PM / 人間の判断が必要です。` });
  }

  const failed = [];
  for (const name of config.green) {
    const cmd = config.commands[name];
    if (!cmd) continue;
    const r = runCommand(root, cmd, { timeoutMs: 300000 });
    if (r.code !== 0) failed.push(`[${name}] ${summarize(r.output, 6)}`);
  }
  if (failed.length) {
    writeJSON(cacheFile, { hash, ok: false, blocks: blocks + 1 });
    out({
      decision: 'block',
      reason: `[GATE] 自動チェックが失敗しています。修正してから終了してください（${blocks + 1}/${config.maxStopBlocks}）:\n${failed.join('\n')}`,
    });
  }
  writeJSON(cacheFile, { hash, ok: true, blocks: 0 });
  process.exit(0);
} catch {
  process.exit(0);
}
