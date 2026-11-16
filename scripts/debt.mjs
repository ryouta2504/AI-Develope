#!/usr/bin/env node
// 技術的負債の台帳: npm run debt [-- --check | --all]
//   （引数なし）未解消（未対応・計画済）を重大度順に表示 / --all 全件 / --check 台帳の書式を検査（問題があれば終了コード 1）
import { findRoot, readText } from './lib/util.mjs';
import path from 'node:path';
import { loadConfig, DEBT_FILE } from './lib/config.mjs';
import { loadDebt, debtProblems, debtSummary, DEBT_SEVERITIES } from './lib/debt.mjs';

const root = findRoot(process.cwd());
if (!root) {
  console.error('プロジェクトルート（.ai-dev）が見つかりません');
  process.exit(1);
}
const args = process.argv.slice(2);

if (args.includes('--check')) {
  const p = debtProblems(readText(path.join(root, DEBT_FILE), ''));
  if (p.length) {
    console.error(`❌ ${DEBT_FILE} に問題があります:`);
    for (const x of p) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`✅ ${DEBT_FILE} の書式は正しいです`);
  process.exit(0);
}

const items = loadDebt(root);
const shown = (args.includes('--all') ? items : items.filter((d) => ['未対応', '計画済'].includes(d.status))).sort((a, b) => DEBT_SEVERITIES.indexOf(a.severity) - DEBT_SEVERITIES.indexOf(b.severity));
if (!shown.length) console.log('未解消の技術的負債はありません。');
for (const d of shown) console.log(`${d.id} [${d.severity}] ${d.status} ${d.title}（${d.place}）← ${d.source}${d.note ? ` / ${d.note}` : ''}`);
const s = debtSummary(root, loadConfig(root).debtThreshold);
if (s.needsRefactor) console.log(`\n→ 未解消 ${s.open.length} 件（高 ${s.high} 件）。リファクタリングサイクルを計画に入れてください: npm run cycle:new -- --refactor --debt DEBT-001 <名前>`);
