#!/usr/bin/env node
// 自動ゲートの判定（決定的な処理は LLM に任せず、このスクリプトで判定する）
// 使い方: npm run gate -- <REQ_REVIEW|DESIGN_REVIEW|RED|GREEN|CODE_REVIEW|PLATFORM_REVIEW>
//         npm run gate -- wp <WP-xx>     （並列実装の worktree 内で、その WP の GREEN を判定）
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, readText, nowIso, currentBranch, writeJSON, git, hashTree } from './lib/util.mjs';
import { loadConfig, artifactPaths, REVIEWS, isTestFile } from './lib/config.mjs';
import { deriveState, computeArtifacts, writeRecord, readRecord, recordPath, appendHistory, lockableFiles } from './lib/state.mjs';
import { reviewProblems, SKIP_RE, testIdsInCode, parseWorkPackages } from './lib/ids.mjs';
import { buildTrace, traceProblems } from './lib/trace.mjs';
import { runCommand, runGreen, summarize } from './lib/run.mjs';
import { isRefactorCycle, refactorDebtProblems } from './lib/debt.mjs';
import { reviewEvidenceProblems, platformReviewProblems, changedPlatformFiles } from './lib/review-evidence.mjs';

const [gateArg, wpArg] = process.argv.slice(2);
const gate = (gateArg || '').toUpperCase();
const root = findRoot(process.cwd());
if (!root) fail('プロジェクトルート（.ai-dev）が見つかりません');
const config = loadConfig(root);
const state = deriveState(root);

function fail(msg, details = []) {
  console.error(`❌ [GATE${gate ? ' ' + gate : ''}] 不合格: ${msg}`);
  for (const d of details.slice(0, 15)) console.error(`  - ${d}`);
  if (details.length > 15) console.error(`  …ほか ${details.length - 15} 件`);
  process.exit(1);
}

function pass(stepId, extra = {}) {
  const record = { step: stepId, status: 'passed', at: nowIso(), by: 'gate-script', artifacts: computeArtifacts(root, state.cycle, stepId), ...extra };
  writeRecord(root, state.cycle, stepId, record);
  // ゲート記録はコミットして残す（worktree・CI・PR から参照できるように）
  const dir = `.ai-dev/cycles/${state.cycle}`;
  git(root, ['add', dir]);
  git(root, ['commit', '-m', `chore(${state.cycle.match(/^C-\d+/)[0]}): gate ${stepId} passed`, '--', dir]);
  console.log(`✅ [GATE ${stepId}] 合格（${state.cycle}）`);
  console.log(`   現在のフェーズ: ${deriveState(root).phase}`);
}

function requirePhase(...expected) {
  if (!state.cycle) fail('アクティブなサイクルがありません（npm run cycle:new）');
  if (!expected.includes(state.phase)) fail(`現在のフェーズは ${state.phase} です。${gate} は ${expected.join(' / ')} フェーズで判定します。`);
}

/** そのゲートで照合するレビュー（指摘表 + 相互レビューの実施記録） */
function reviewChecks(gateId) {
  const rv = Object.keys(REVIEWS).find((k) => REVIEWS[k].gate === gateId && REVIEWS[k].doc);
  if (!rv) return [];
  const doc = a[REVIEWS[rv].doc];
  return [...reviewProblems(read(doc), doc), ...reviewEvidenceProblems(root, state.cycle, rv)];
}

const a = state.cycle ? artifactPaths(state.cycle) : null;
const read = (p) => readText(path.join(root, p), null);

switch (gate) {
  case 'REQ_REVIEW': {
    requirePhase('requirements');
    if (!read(a.req)) fail(`${a.req} がありません`);
    const p = [...traceProblems(buildTrace(root, state.cycle), 'requirements'), ...reviewChecks(gate)];
    if (p.length) fail('要求定義またはレビュー記録に問題があります', p);
    pass(gate);
    break;
  }
  case 'DESIGN_REVIEW': {
    requirePhase('design');
    if (!read(a.design)) fail(`${a.design} がありません`);
    const p = [...traceProblems(buildTrace(root, state.cycle), 'design'), ...reviewChecks(gate)];
    for (const [wp, globs] of parseWorkPackages(read(a.design))) if (globs.length === 0) p.push(`${wp}: 所有パスがありません`);
    if (p.length) fail('設計書またはレビュー記録に問題があります', p);
    pass(gate);
    break;
  }
  case 'RED': {
    requirePhase('test_design');
    if (!read(a.testPlan)) fail(`${a.testPlan} がありません`);
    const p = [...traceProblems(buildTrace(root, state.cycle), 'red'), ...reviewChecks(gate)];
    const files = lockableFiles(root);
    for (const f of files) if (SKIP_RE.test(readText(path.join(root, f), ''))) p.push(`${f}: .skip / .only などが含まれています`);
    if (testIdsInCode(root).size === 0) p.push('テストコードに [TC-xxx] を含むテストがありません');
    if (p.length) fail('テスト設計に問題があります', p);

    // 再オープン時は、変更・追加されたテストファイルだけが失敗すればよい
    const reopen = readRecord(root, state.cycle, 'RED_REOPEN');
    let cmd = config.commands.test;
    if (reopen?.previousLock) {
      const now = computeArtifacts(root, state.cycle, 'RED');
      const changed = files.filter((f) => isTestFile(f) && reopen.previousLock[`file:${f}`] !== now[`file:${f}`]);
      if (changed.length === 0) fail('再オープン後に変更されたテストがありません');
      cmd = config.commands.testFiles.replace('{files}', changed.map((f) => `"${f}"`).join(' '));
    }
    const r = runCommand(root, cmd);
    if (isRefactorCycle(state.cycle)) {
      // リファクタリングは振る舞いを変えない: 既存テストがすべて成功している状態をロックする（以後テストは書き換えられない）
      if (r.code !== 0) fail('リファクタリングサイクルでは、着手前に既存のテストがすべて成功している必要があります（振る舞いの基準にするため）。', summarize(r.output).split('\n'));
      pass('RED', { refactor: true, baseline: summarize(r.output, 4) });
      break;
    }
    if (r.code === 0) fail('テストが成功しました。RED（失敗するテスト）になっていません。実装より先に、失敗するテストを書いてください。');
    if (/command not found|is not recognized|Cannot find module|ERR_MODULE_NOT_FOUND|missing script/i.test(r.output) && !/FAIL|failed|AssertionError/i.test(r.output))
      fail('テストが「実行できない」状態です（テストの失敗ではなく、環境・設定のエラー）。', summarize(r.output).split('\n'));
    pass('RED', { redOutput: summarize(r.output, 8) });
    if (reopen) fs.rmSync(recordPath(root, state.cycle, 'RED_REOPEN'), { force: true });
    break;
  }
  case 'GREEN': {
    requirePhase('implementation', 'ai_review');
    const { results, failed } = runGreen(root, config, { report: true });
    if (failed.length) fail(`${failed.map((f) => f.name).join(', ')} が失敗しました`, failed.flatMap((f) => [`[${f.name}] ${f.command}`, ...summarize(f.output, 8).split('\n')]));
    const p = traceProblems(buildTrace(root, state.cycle), 'green');
    if (p.length) fail('トレーサビリティに欠落があります（TRACE）', p);
    pass('GREEN', { checks: results.map((r) => ({ name: r.name, code: r.code, ms: r.ms })) });
    break;
  }
  case 'CODE_REVIEW': {
    requirePhase('ai_review');
    const p = [...reviewChecks(gate), ...(isRefactorCycle(state.cycle) ? refactorDebtProblems(root, state.cycle) : [])];
    if (p.length) fail('コードレビューの指摘、または対象の負債の解消が済んでいません', p);
    pass(gate);
    break;
  }
  case 'WP': {
    // worktree 内で実行する。WP 単位の GREEN（その WP の担当テストを含む全テスト・lint・型チェック）
    const wp = (wpArg || '').toUpperCase();
    const branch = currentBranch(root);
    if (!branch.startsWith('wp/') || !branch.includes(`/${wp}`)) fail(`WP ブランチ上で実行してください（現在: ${branch}）`);
    if (!parseWorkPackages(read(a.design)).has(wp)) fail(`${wp} は設計書の WP 表にありません`);
    const { failed } = runGreen(root, config);
    if (failed.length) fail(`${failed.map((f) => f.name).join(', ')} が失敗しました`, failed.flatMap((f) => summarize(f.output, 8).split('\n')));
    const file = path.join(root, '.ai-dev', 'cycles', state.cycle, 'wp', `${wp}.json`);
    writeJSON(file, { wp, status: 'passed', at: nowIso(), branch, tree: { src: hashTree(root, 'src'), e2e: hashTree(root, 'e2e') } });
    appendHistory(root, state.cycle, { type: 'wp_green', wp, branch });
    console.log(`✅ [GATE WP ${wp}] 合格。PM が npm run wp:merge -- ${wp} でサイクルブランチへマージできます。`);
    break;
  }
  case 'PLATFORM_REVIEW': {
    // テンプレートの変更に対する相互レビュー（RV-PF）の確認。記録は作らず、CI と同じ照合だけを行う
    const changed = changedPlatformFiles(root);
    if (!changed.length) {
      console.log('✅ テンプレートのファイルの変更はありません（RV-PF 不要）');
      break;
    }
    const p = platformReviewProblems(root);
    if (p.length) fail(`テンプレートのファイル ${changed.length} 件の変更に、有効な相互レビュー（RV-PF）がそろっていません`, p);
    console.log(`✅ [GATE PLATFORM_REVIEW] テンプレートのファイル ${changed.length} 件の変更は、全観点で相互レビュー済みです`);
    break;
  }
  default:
    console.error('使い方: npm run gate -- <REQ_REVIEW|DESIGN_REVIEW|RED|GREEN|CODE_REVIEW|PLATFORM_REVIEW>  /  npm run gate -- wp <WP-xx>');
    process.exit(2);
}
