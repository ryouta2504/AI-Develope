#!/usr/bin/env node
// CI（GitHub Actions）用のサーバー側ゲート
// ローカルのフックを迂回されても、ここで成果物ハッシュ・承認・テスト・相互レビューを再検証する。
//
// 既知の限界: このスクリプト自体も PR の中身で動くため、PR がこれを書き換えれば検査を弱められる。
// そのため .github/CODEOWNERS でテンプレートのファイルにコードオーナーのレビューを必須にしている（ブランチ保護で有効化）。
import { execFileSync } from 'node:child_process';
import { findRoot, git, matchAny } from './lib/util.mjs';
import { deriveState, STEPS, readRecord, isRecordValid, staleKeys } from './lib/state.mjs';
import { loadConfig, REVIEWS } from './lib/config.mjs';
import { buildTrace, traceProblems } from './lib/trace.mjs';
import { runCommand, runGreen, summarize } from './lib/run.mjs';
import { reviewEvidenceProblems, platformReviewProblems } from './lib/review-evidence.mjs';
import { loadBranching } from './lib/branching.mjs';
import { isRefactorCycle, refactorDebtProblems, debtProblems } from './lib/debt.mjs';
import { readText } from './lib/util.mjs';

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

// ブランチの接頭辞ごとに「何を許すか」を決める。どれにも当てはまらないブランチは不合格（fail-closed）。
// plan/* で許す変更: 開発計画・改善候補・G0 の承認記録・履歴（history.jsonl）だけ（src などを混ぜた PR は通さない）
const PLAN_ALLOWED = ['docs/plan.md', 'docs/improvements.md', '.ai-dev/approvals/G0.json', '.ai-dev/history.jsonl'];
const branching = loadBranching(root);
const isRelease = !!branching.release && branch === branching.base; // develop → main のリリース PR（中身は各 cycle PR で検証済み）
const kind = branch.startsWith('cycle/') ? 'cycle' : branch.startsWith('plan/') ? 'plan' : branch.startsWith('feature/') ? 'feature' : isRelease ? 'release' : 'unknown';

step(`ブランチの種類（${kind}）`, () => {
  if (kind === 'unknown') {
    throw new Error(`ブランチ ${branch} は PR を許可していません。cycle/*（サイクル）・plan/*（計画）・feature/*（テンプレートの変更）のいずれかにしてください。wp/* は cycle/* にマージしてから PR を出します`);
  }
});

if (kind === 'plan') {
  step('G0（開発計画の承認）', () => {
    if (!state.g0.valid) throw new Error('G0 が未承認、または承認後に docs/plan.md が変更されています');
  });
  step('plan/* の変更範囲（計画と G0 の承認記録のみ）', () => {
    const changed = (git(root, ['diff', '--name-only', `${base}...HEAD`]) || '').split(/\r?\n/).filter(Boolean);
    // 終わったサイクルの後も state.cycle が残るため、PM が計画を直すと、そのサイクルの activity.jsonl（誰が何を書いたかの記録）に追記される。これも許す
    const outside = changed.filter((f) => !matchAny(f, PLAN_ALLOWED) && !/^\.ai-dev\/cycles\/[^/]+\/activity\.jsonl$/.test(f));
    if (outside.length) throw new Error(`計画以外のファイルが含まれています: ${outside.slice(0, 5).join(', ')}`);
  });
}

if (kind === 'cycle') {
  const cycle = branch.slice('cycle/'.length);
  step('G0（開発計画の承認）', () => {
    if (!state.g0.valid) throw new Error('G0 が未承認、または承認後に docs/plan.md が変更されています');
  });
  step('サイクルの一致', () => {
    if (state.cycle !== cycle) throw new Error(`.ai-dev/current.json のサイクル（${state.cycle}）とブランチ（${cycle}）が一致しません`);
  });
  // 各ゲート記録の成果物ハッシュを再計算して検証する（承認後の変更を検出）。G3 は人間が承認するまで不合格になる。
  // G0 の状態に関係なく、STEPS から必ず全ゲートを照合する（deriveState の steps には頼らない）
  for (const s of STEPS) {
    step(`${s.id}（${s.kind === 'human' ? '人間' : '自動'}）`, () => {
      const record = readRecord(root, cycle, s.id);
      if (!record) throw new Error('記録がありません');
      if (['rejected', 'invalidated'].includes(record.status)) throw new Error(`${record.status === 'rejected' ? '差し戻し中' : '無効'}: ${record.reason}`);
      if (!isRecordValid(root, record)) throw new Error(`記録後に変更されています: ${staleKeys(root, record).slice(0, 5).join(', ')}`);
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
      const p = reviewEvidenceProblems(root, cycle, rv, { checkTargets: REVIEWS[rv].checkTargetsInCi !== false });
      if (p.length) throw new Error(p.slice(0, 5).join(' / '));
    });
  }
  step('技術的負債の台帳の書式', () => {
    const p = debtProblems(readText(`${root}/docs/debt.md`, ''));
    if (p.length) throw new Error(p.slice(0, 5).join(' / '));
  });
  if (isRefactorCycle(cycle)) {
    step('リファクタリング: 対象の負債の解消', () => {
      const p = refactorDebtProblems(root, cycle);
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
