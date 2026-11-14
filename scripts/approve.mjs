#!/usr/bin/env node
// 人間の承認: npm run approve -- <G0|G1|G2|G3>
import path from 'node:path';
import { findRoot, nowIso, readText } from './lib/util.mjs';
import { deriveState, computeArtifacts, writeRecord } from './lib/state.mjs';
import { artifactPaths, PLAN_FILE } from './lib/config.mjs';
import { parseReview } from './lib/ids.mjs';
import { requireHuman, ask, whoAmI, commitAiDev, scopeOf } from './lib/human.mjs';
import { loadBranching, describeBranching } from './lib/branching.mjs';

requireHuman();
const root = findRoot(process.cwd());
const gate = (process.argv[2] || '').toUpperCase();
if (!['G0', 'G1', 'G2', 'G3'].includes(gate)) {
  console.error('使い方: npm run approve -- <G0|G1|G2|G3>');
  process.exit(2);
}
const state = deriveState(root);

// 前提: 承認対象のゲートが「次に通るべきゲート」であること（＝手前の自動ゲートが通過済み）
const expected = state.phase === 'planning' ? 'G0' : state.blockingStep?.id;
if (gate !== expected) {
  console.error(`⛔ いま承認できるのは ${expected ? expected : '（なし）'} です。現在のフェーズ: ${state.phase}`);
  if (state.blockingStep && state.blockingStep.kind === 'auto') console.error(`   先に自動ゲート ${state.blockingStep.id} を通過させる必要があります。`);
  process.exit(1);
}

const artifacts = computeArtifacts(root, state.cycle, gate);
console.log(`\n=== ${gate} 承認 ${state.cycle ? `（サイクル ${state.cycle}）` : '（開発計画）'} ===\n`);
console.log('承認対象（この内容で凍結されます。変更されると承認は自動で無効になります）:');
for (const [k, h] of Object.entries(artifacts)) {
  console.log(`  ${h === 'MISSING' ? '⚠ なし' : h.slice(0, 10)}  ${k.replace(/^(file|tree):/, '')}`);
}
if (gate === 'G0' && artifacts[`file:${PLAN_FILE}`] === 'MISSING') {
  console.error(`\n⛔ ${PLAN_FILE} がありません。`);
  process.exit(1);
}
if (gate === 'G0') {
  const b = loadBranching(root);
  if (b.error) {
    console.error(`\n⛔ ${b.error}`);
    process.exit(1);
  }
  console.log(`\nブランチ戦略${b.source === 'default' ? '（計画に記載なし → 既定値）' : ''}: ${describeBranching(b)}`);
}
if (state.cycle) {
  const a = artifactPaths(state.cycle);
  const rv = { G1: [a.rvReq], G2: [a.rvDesign], G3: [a.rvTest, a.rvCode] }[gate] || [];
  for (const f of rv) {
    const { findings } = parseReview(readText(path.join(root, f), ''));
    const count = (s) => findings.filter((x) => x.severity === s).length;
    const open = findings.filter((x) => !/対応済|却下/.test(x.status));
    console.log(`\nレビュー記録 ${f}: Critical ${count('Critical')} / Major ${count('Major')} / Minor ${count('Minor')}（未対応・保留 ${open.length} 件）`);
    for (const o of open.slice(0, 10)) console.log(`  - ${o.id} [${o.severity}] ${o.status}: ${o.action}`);
  }
  console.log(`\n詳細は docs/cycles/${state.cycle}/ の成果物と reviews/ を確認してください。`);
  if (gate === 'G3') console.log('PR の差分と CI 結果（G3 以外の項目がすべて合格していること）を確認してから承認してください（gh pr view --web）。承認後に push すると CI が再実行され、G3 も合格になります。');
}

const typed = await ask(`\n承認する場合は「APPROVE ${gate}」と入力してください: `);
if (typed !== `APPROVE ${gate}`) {
  console.log('承認を中止しました。');
  process.exit(1);
}
const comment = await ask('コメント（任意・Enter でスキップ）: ');
const by = whoAmI(root);
writeRecord(root, state.cycle, gate, { step: gate, status: 'approved', at: nowIso(), by, artifacts, comment });
console.log(`\n✅ ${gate} を承認しました（承認者: ${by}）`);
console.log(`   次のフェーズ: ${deriveState(root).phase}`);
await commitAiDev(root, `chore(${scopeOf(state.cycle)}): approve ${gate}${comment ? `\n\n${comment}` : ''}`);
