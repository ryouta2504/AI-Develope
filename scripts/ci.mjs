#!/usr/bin/env node
// CI（GitHub Actions）用のサーバー側ゲート
// ローカルのフックを迂回されても、ここで成果物ハッシュ・承認・テストを再検証する。
import { execFileSync } from 'node:child_process';
import { findRoot, git } from './lib/util.mjs';
import { deriveState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { buildTrace, traceProblems } from './lib/trace.mjs';
import { runCommand, summarize } from './lib/run.mjs';

const root = findRoot(process.cwd());
const branch = process.env.GITHUB_HEAD_REF || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
const problems = [];
const step = (name, fn) => {
  try {
    const r = fn();
    console.log(`${r === false ? '❌' : '✅'} ${name}`);
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    console.log(`❌ ${name}`);
  }
};

console.log(`ブランチ: ${branch}（ベース: ${base}）\n`);

step('コミットメッセージ規約', () => {
  execFileSync(process.execPath, ['scripts/check-commit-msg.mjs', '--range', `${base}..HEAD`], { cwd: root, stdio: 'inherit' });
});

step('基盤のテスト（フック・ゲート）', () => {
  const r = runCommand(root, 'npm run test:platform --silent');
  if (r.code !== 0) throw new Error(summarize(r.output));
});

const state = deriveState(root);

if (branch.startsWith('plan/')) {
  step('G0（開発計画の承認）', () => {
    if (!state.g0.valid) throw new Error('G0 が未承認、または承認後に docs/plan.md が変更されています');
  });
}

if (branch.startsWith('cycle/')) {
  const cycle = branch.slice('cycle/'.length);
  step('サイクルの一致', () => {
    if (state.cycle !== cycle) throw new Error(`.ai-dev/current.json のサイクル（${state.cycle}）とブランチ（${cycle}）が一致しません`);
  });
  // 各ゲート記録の成果物ハッシュを再計算して検証する（承認後の改ざん・変更を検出）
  for (const s of state.steps) {
    step(`${s.id}（${s.kind === 'human' ? '人間' : '自動'}）`, () => {
      if (!s.record) throw new Error('記録がありません');
      if (s.record.status === 'rejected') throw new Error(`差し戻し中: ${s.record.reason}`);
      if (!s.valid) throw new Error(`記録後に変更されています: ${s.stale.slice(0, 5).join(', ')}`);
    });
  }
  // 自動ゲートの中身（テスト・lint・型）は記録を信用せず、CI で実際に再実行する
  const config = loadConfig(root);
  for (const name of config.green) {
    step(`再実行: ${name}`, () => {
      const r = runCommand(root, config.commands[name]);
      if (r.code !== 0) throw new Error(summarize(r.output));
    });
  }
  step('トレーサビリティ', () => {
    const p = traceProblems(buildTrace(root, cycle), 'red');
    if (p.length) throw new Error(p.slice(0, 10).join(' / '));
  });
}

if (problems.length) {
  console.error('\n不合格の項目:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✅ すべてのサーバー側ゲートに合格しました');
