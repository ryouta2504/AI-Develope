#!/usr/bin/env node
// 人間の差し戻し: npm run reject -- <> "理由"
import { findRoot } from './lib/util.mjs';
import { deriveState, rejectGate, readRecord, HUMAN_GATES } from './lib/state.mjs';
import { requireHuman, ask, whoAmI, commitAiDev, scopeOf } from './lib/human.mjs';

requireHuman();
const root = findRoot(process.cwd());
const gate = (process.argv[2] || '').toUpperCase();
let reason = process.argv.slice(3).join(' ').trim();
if (!HUMAN_GATES.includes(gate)) {
  console.error(`使い方: npm run reject -- <${HUMAN_GATES.join('|')}> "理由"`);
  process.exit(2);
}
const state = deriveState(root);
// 差し戻せるのは、承認待ち（次に通るゲート）か、承認済みのゲートだけ
if (gate !== 'G0') {
  if (!state.cycle) {
    console.error('⛔ アクティブなサイクルがありません。G1〜G3 は差し戻せません。');
    process.exit(1);
  }
  if (state.blockingStep?.id !== gate && !readRecord(root, state.cycle, gate)) {
    console.error(`⛔ ${gate} にはまだ到達していません（現在のフェーズ: ${state.phase}）。`);
    process.exit(1);
  }
}
if (!reason) reason = await ask('差し戻しの理由（必須）: ');
if (!reason) {
  console.error('理由は必須です。');
  process.exit(1);
}
const typed = await ask(`差し戻す場合は「REJECT ${gate}」と入力してください: `);
if (typed !== `REJECT ${gate}`) {
  console.log('中止しました。');
  process.exit(1);
}
// 差し戻し時点の成果物ハッシュも残す（何に対する差し戻しかを追跡するため）。直前の自動ゲートも無効にする
rejectGate(root, state.cycle, gate, { by: whoAmI(root), reason });
console.log(`\n↩ ${gate} を差し戻しました（理由: ${reason}）`);
console.log(`   現在のフェーズ: ${deriveState(root).phase}`);
console.log('   AI は修正 → 再レビュー → 自動ゲート → 再度あなたの承認、の順で進めます。');
await commitAiDev(root, `chore(${scopeOf(state.cycle)}): reject ${gate}\n\n${reason}`);
