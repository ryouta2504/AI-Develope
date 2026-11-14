#!/usr/bin/env node
// 人間によるテストロックの解除: npm run reopen -- RED "理由"
// 実装中に「テスト自体が誤っている」と分かったときに使う。フェーズは test_design に戻る。
import fs from 'node:fs';
import { findRoot, nowIso } from './lib/util.mjs';
import { deriveState, readRecord, recordPath, writeRecord } from './lib/state.mjs';
import { requireHuman, ask, whoAmI, commitAiDev, scopeOf } from './lib/human.mjs';

requireHuman();
const root = findRoot(process.cwd());
const target = (process.argv[2] || '').toUpperCase();
let reason = process.argv.slice(3).join(' ').trim();
if (target !== 'RED') {
  console.error('使い方: npm run reopen -- RED "理由"');
  process.exit(2);
}
const state = deriveState(root);
const red = readRecord(root, state.cycle, 'RED');
if (!red) {
  console.error('RED の記録がありません。');
  process.exit(1);
}
if (!reason) reason = await ask('ロック解除の理由（必須）: ');
if (!reason) process.exit(1);
if ((await ask('解除する場合は「REOPEN RED」と入力してください: ')) !== 'REOPEN RED') process.exit(1);

writeRecord(root, state.cycle, 'RED_REOPEN', { step: 'RED_REOPEN', status: 'reopened', at: nowIso(), by: whoAmI(root), reason, previousLock: red.artifacts });
fs.rmSync(recordPath(root, state.cycle, 'RED'), { force: true });
console.log(`🔓 テストロックを解除しました。フェーズ: ${deriveState(root).phase}`);
console.log('   変更したテストが RED（失敗）になることを、再度 npm run gate -- RED で確認します。');
await commitAiDev(root, `chore(${scopeOf(state.cycle)}): reopen RED\n\n${reason}`);
