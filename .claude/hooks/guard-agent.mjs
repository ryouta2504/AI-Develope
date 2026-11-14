// PreToolUse: Agent / Task / SendMessage
// - reviewer への依頼文は決められた 4 行だけ（コールドレビュー: 経緯や意見を渡さない）
// - 一度レビューした reviewer に追加の指示を送って再利用することを禁止（毎回新しく起動する）
import fs from 'node:fs';
import path from 'node:path';
import { readInput, block } from './_io.mjs';
import { findRoot, currentBranch } from '../../scripts/lib/util.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { checkReviewRequest, loadRuns, platformScope } from '../../scripts/lib/review-evidence.mjs';

const input = await readInput();
try {
  const root = findRoot(input.cwd || process.cwd()) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);
  const ti = input.tool_input || {};
  const state = deriveState(root);

  if (input.tool_name === 'SendMessage') {
    const to = String(ti.to || ti.recipient || '');
    const runs = [...(state.cycle ? loadRuns(root, state.cycle) : []), ...loadRuns(root, platformScope(currentBranch(root)))];
    if (to && runs.some((r) => r.agent_id && to.includes(r.agent_id))) {
      block('レビュー済みの reviewer に追加の指示を送ることはできません（前のレビューの記憶が残り、コールドレビューにならないため）。', '再レビューは、新しい reviewer を起動して行ってください。');
    }
    process.exit(0);
  }

  if (ti.subagent_type === 'reviewer') {
    const r = checkReviewRequest({ root, prompt: ti.prompt, state });
    if (!r.allow) block(r.reason, r.hint);
  }
  process.exit(0);
} catch (e) {
  block(`ガードの内部エラーのため止めました: ${e.message}`, '人間に .claude/hooks と scripts/lib の確認を依頼してください。');
}
