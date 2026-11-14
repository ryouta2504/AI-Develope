#!/usr/bin/env node
// CI（GitHub Actions）用のサーバー側ゲート
// ローカルのフックを迂回されても、ここで成果物ハッシュ・承認・テスト・相互レビューを再検証する。
//
// 既知の限界: このスクリプト自体も PR の中身で動くため、PR がこれを書き換えれば検査を弱められる。
// そのため .github/CODEOWNERS でテンプレートのファイルにコードオーナーのレビューを必須にしている（ブランチ保護で有効化）。
import { execFileSync } from 'node:child_process';
import { findRoot, git } from './lib/util.mjs';
import { deriveState } from './lib/state.mjs';
import { loadConfig, REVIEWS } from './lib/config.mjs';
import { buildTrace, traceProblems } from './lib/trace.mjs';
import { runCommand, runGreen, summarize } from './lib/run.mjs';
import { reviewEvidenceProblems, platformReviewProblems } from './lib/review-evidence.mjs';
import { loadBranching } from './lib/branching.mjs';

const root = findRoot(process.cwd());
const branch = process.env.GITHUB_HEAD_REF || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
const base = `origin/${process.env.GITHUB_BASE_REF || loadBranching(root).base}`;
const problems = [];
const step = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
    console.log(`❌ ${name}`);
  }
};

console.log(`ブランチ: ${branch}（ベース: ${base}）\n`);

step('コミットメッセージ規約', () => {
  execFileSync(process.execPath, ['scripts/check-commit-msg.mjs', '--range', `${base}..HEAD`], { cwd: root, stdio: 'inherit' });
});

step('テンプレートのテスト（フック・ゲート）', () => {
  const r = runCommand(root, 'npm run test:platform --silent');
  if (r.code !== 0) throw new Error(summarize(r.output));
});

const state = deriveState(root);

// テンプレートのファイルを変える PR は、どのブランチでも RV-PF の相互レビューが必要
step('テンプレートの変更の相互レビュー（RV-PF）', () => {
  const p = platformReviewProblems(root, branch);
  if (p.length) throw new Error(p.slice(0, 6).join(' / '));
});

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
  // 各ゲート記録の成果物ハッシュを再計算して検証する（承認後の変更を検出）。G3 は人間が承認するまで不合格になる
  for (const s of state.steps) {
    step(`${s.id}（${s.kind === 'human' ? '人間' : '自動'}）`, () => {
      if (!s.record) throw new Error('記録がありません');
      if (['rejected', 'invalidated'].includes(s.record.status)) throw new Error(`${s.record.status === 'rejected' ? '差し戻し中' : '無効'}: ${s.record.reason}`);
      if (!s.valid) throw new Error(`記録後に変更されています: ${s.stale.slice(0, 5).join(', ')}`);
    });
  }
  // 自動ゲートの中身（テスト・lint・型・ビルド・E2E）は記録を信用せず、CI で実際に再実行する
  const config = loadConfig(root);
  const { results } = runGreen(root, config, { report: true });
  for (const r of results) {
    step(`再実行: ${r.name}`, () => {
      if (r.code !== 0) throw new Error(summarize(r.output));
    });
  }
  // 相互レビューの実施記録も照合する。RV-03 の後には実装フェーズで新しいテストが追加されうる（それらは RV-05 の対象）ため、
  // RV-03 は実施の有無と独立性だけを確認する
  for (const rv of Object.keys(REVIEWS).filter((k) => REVIEWS[k].phases)) {
    step(`相互レビューの実施記録 ${rv}`, () => {
      const p = reviewEvidenceProblems(root, cycle, rv, { checkTargets: rv !== 'RV-03' });
      if (p.length) throw new Error(p.slice(0, 5).join(' / '));
    });
  }
  step('トレーサビリティ（全 TC の成功まで）', () => {
    const p = traceProblems(buildTrace(root, cycle), 'green');
    if (p.length) throw new Error(p.slice(0, 10).join(' / '));
  });
}

if (problems.length) {
  console.error('\n不合格の項目:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✅ すべてのサーバー側ゲートに合格しました');
