#!/usr/bin/env node
// トレーサビリティマトリクスの生成と検証
//   npm run trace             … docs/cycles/<サイクル>/traceability.md を生成
//   npm run trace -- --check  … フェーズに応じた欠落チェック（問題があれば終了コード 1）
import fs from 'node:fs';
import path from 'node:path';
import { findRoot } from './lib/util.mjs';
import { deriveState } from './lib/state.mjs';
import { artifactPaths } from './lib/config.mjs';
import { buildTrace, traceProblems, renderMatrix } from './lib/trace.mjs';

const root = findRoot(process.cwd());
const state = deriveState(root);
const cycle = process.argv.find((a) => /^C-\d+/.test(a)) || state.cycle;
if (!cycle) {
  console.error('アクティブなサイクルがありません');
  process.exit(1);
}
const t = buildTrace(root, cycle);
const levelByPhase = { requirements: 'requirements', design: 'design', test_design: 'red' };
const level = process.argv.find((a) => a.startsWith('--level='))?.slice(8) || levelByPhase[state.phase] || 'green';

if (process.argv.includes('--check')) {
  const p = traceProblems(t, level);
  if (p.length) {
    console.error(`❌ トレーサビリティの欠落（${level}）:`);
    for (const x of p.slice(0, 20)) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`✅ トレーサビリティ OK（${level}）: REQ ${t.reqs.size} 件 / TC ${t.tcDefs.size} 件`);
} else {
  const out = path.join(root, artifactPaths(cycle).trace);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMatrix(t, cycle));
  const missing = t.rows.filter((r) => !r.des.length || !r.tcs.length).length;
  console.log(`📊 ${artifactPaths(cycle).trace} を生成しました（${t.rows.length} 行、欠落あり ${missing} 行）`);
}
