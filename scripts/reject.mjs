#!/usr/bin/env node
// 人間の差し戻し: npm run reject -- <G0|G1|G2|G3> "理由"
import { findRoot } from './lib/util.mjs';
import { deriveState, rejectGate } from './lib/state.mjs';
import { requireHuman, ask, whoAmI, commitAiDev, scopeOf } from './lib/human.mjs';

requireHuman();
const root = findRoot(process.cwd());
const gate = (process.argv[2] || '').toUpperCase();
let reason = process.argv.slice(3).join(' ').trim();
if (!['G0', 'G1', 'G2', 'G3'].includes(gate)) {
  console.error('使い方: npm run reject -- <G0|G1|G2|G3> "理由"');
  process.exit(2);
}
const state = deriveState(root);
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
