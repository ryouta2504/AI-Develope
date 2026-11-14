// Stop / SubagentStop
// - reviewer の終了時: 相互レビューの実施記録を残す
// - implementer の終了時: src/ が変わっていれば GREEN のチェックを実行し、失敗なら終了をブロックする（自分で直させる）
// - メインセッション（PM）の終了時: ブロックしない。人間の承認待ちなどを通知するだけ（PM が人間に返せなくなるのを防ぐ）
import fs from 'node:fs';
import path from 'node:path';
import { readInput } from './_io.mjs';
import { findRoot, hashTree, readJSON, writeJSON, currentBranch } from '../../scripts/lib/util.mjs';
import { deriveState, nextAction } from '../../scripts/lib/state.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';
import { runGreen, summarize } from '../../scripts/lib/run.mjs';
import { recordReviewRun } from '../../scripts/lib/review-evidence.mjs';

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

  if (isSub && input.agent_type === 'reviewer') {
    const run = recordReviewRun({ root, state, input, branch: currentBranch(root) });
    if (run && (!run.rv || !run.perspective)) out({ systemMessage: '⚠ reviewer の依頼文からレビュー番号・観点を読み取れませんでした。この実施はゲートで数えられません。' });
    process.exit(0);
  }

  if (!isSub) {
    if (state.blockingStep?.kind === 'human') out({ systemMessage: `⏸ 人間の承認待ちです: ${nextAction(state)}` });
    process.exit(0);
  }

  // ここから implementer の終了時だけ
  if (input.agent_type !== 'implementer' || !['implementation', 'ai_review'].includes(state.phase)) process.exit(0);

  const config = loadConfig(root);
  const cacheFile = path.join(root, '.ai-dev', '.cache', 'stop-gate.json');
  const cache = readJSON(cacheFile, {});
  const hash = `${hashTree(root, 'src')}:${hashTree(root, 'e2e')}`;
  if (hash.startsWith('EMPTY:')) process.exit(0);
  if (cache.hash === hash && cache.ok) process.exit(0);

  // 無限ループ防止: 連続ブロックが上限に達したら止めずに PM へ知らせる
  const blocks = cache.hash === hash ? cache.blocks || 0 : 0;
  if (input.stop_hook_active && blocks >= config.maxStopBlocks) {
    writeJSON(cacheFile, { hash, ok: false, blocks: 0 });
    out({ systemMessage: `⚠ 自動チェックが ${config.maxStopBlocks} 回連続で失敗しました。PM / 人間の判断が必要です。` });
  }

  const { failed } = runGreen(root, config, { timeoutMs: 300000 });
  if (failed.length) {
    writeJSON(cacheFile, { hash, ok: false, blocks: blocks + 1 });
    out({
      decision: 'block',
      reason: `[GATE] 自動チェックが失敗しています。修正してから終了してください（${blocks + 1}/${config.maxStopBlocks}）:\n${failed.map((f) => `[${f.name}] ${summarize(f.output, 6)}`).join('\n')}`,
    });
  }
  writeJSON(cacheFile, { hash, ok: true, blocks: 0 });
  process.exit(0);
} catch {
  process.exit(0);
}
