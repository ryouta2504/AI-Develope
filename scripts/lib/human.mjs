// 人間専用スクリプトの共通処理（対話端末でのみ動作する）
import readline from 'node:readline/promises';
import { git, currentBranch } from './util.mjs';
import { loadBranching, protectedBranches } from './branching.mjs';

/** AI のシェルは対話端末（TTY）を持たないため、ここで止まる */
export function requireHuman() {
  // CLAUDECODE は Claude Code が自分のシェルに設定する環境変数
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CLAUDECODE) {
    console.error('⛔ このコマンドは人間がターミナルから直接実行する必要があります（対話端末が必要）。');
    console.error('   AI に依頼された場合は、内容を確認したうえでご自身で実行してください。');
    process.exit(3);
  }
}

export async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export function whoAmI(root) {
  const name = git(root, ['config', 'user.name']) || 'unknown';
  return name;
}

/** .ai-dev の変更だけをコミットする（人間の操作として記録） */
export async function commitAiDev(root, message, { offerPush = true } = {}) {
  const branch = currentBranch(root);
  if (protectedBranches(loadBranching(root)).includes(branch)) {
    console.log(`⚠ 保護ブランチ（${branch}）上のためコミットしません。作業ブランチで実行してください。`);
    return;
  }
  git(root, ['add', '.ai-dev']);
  const r = git(root, ['commit', '-m', message, '--', '.ai-dev']);
  if (r === null) {
    console.log('⚠ コミットできませんでした（変更なし、またはエラー）。git status を確認してください。');
    return;
  }
  console.log(`📝 コミットしました: ${message}`);
  if (!offerPush) return;
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const yes = (await ask(`リモートへ push しますか？ ${upstream ? `(${upstream})` : '(origin/' + branch + ')'} [y/N]: `)).toLowerCase() === 'y';
  if (yes) {
    const out = git(root, upstream ? ['push'] : ['push', '-u', 'origin', branch]);
    console.log(out === null ? '⚠ push に失敗しました。手動で git push してください。' : '⬆ push しました。');
  }
}

export function scopeOf(cycleId) {
  return cycleId ? cycleId.match(/^C-\d+/)?.[0] || cycleId : 'plan';
}
