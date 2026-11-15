// ID 抽出・レビュー記録・トレーサビリティ・コミット規約のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirements, parseWorkPackages, reviewProblems, extractDefinitions } from '../../scripts/lib/ids.mjs';
import { buildTrace, traceProblems } from '../../scripts/lib/trace.mjs';
import { checkCommitMessage } from '../../scripts/lib/commitmsg.mjs';
import { makeProject, toPhase, write, CYCLE, REQ_DOC, DESIGN_DOC } from './helpers.mjs';

const D = `docs/cycles/${CYCLE}`;

test('要求定義から REQ・優先度・AC を取得', () => {
  const { reqs } = parseRequirements(REQ_DOC + '\n### REQ-002: 削除できる\n- 優先度: Should\n- 受入基準:\n  - AC-002-1: x\n  - AC-002-2: y\n');
  assert.equal(reqs.get('REQ-001').priority, 'Must');
  assert.deepEqual(reqs.get('REQ-001').acs, ['AC-001-1']);
  assert.equal(reqs.get('REQ-002').priority, 'Should');
  assert.deepEqual(reqs.get('REQ-002').acs, ['AC-002-1', 'AC-002-2']);
});

test('表の行から定義と参照を取得', () => {
  const defs = extractDefinitions(DESIGN_DOC, ['DES', 'WP']);
  assert.deepEqual([...defs.get('DES-001').refs], ['REQ-001']);
  assert.ok(defs.get('WP-02').refs.has('DES-001'));
});

test('WP 表から所有パスを取得', () => {
  const wps = parseWorkPackages(DESIGN_DOC);
  assert.deepEqual(wps.get('WP-01'), ['src/features/add/**']);
});

test('レビュー記録: Critical 未解決・理由なし保留は不合格', () => {
  const doc = (rows) => `| 指摘 ID | 重大度 | 内容 | 状態 | 対応 |\n|---|---|---|---|---|\n${rows}`;
  assert.deepEqual(reviewProblems(doc('| RV-05-001 | Minor | x | 未対応 | - |'), 'r'), []);
  assert.equal(reviewProblems(doc('| RV-05-001 | Critical | x | 未対応 | - |'), 'r').length, 1);
  assert.deepEqual(reviewProblems(doc('| RV-05-001 | Critical | x | 対応済 | abc123 |'), 'r'), []);
  assert.equal(reviewProblems(doc('| RV-05-001 | Major | x | 保留 | - |'), 'r').length, 1);
  assert.deepEqual(reviewProblems(doc('| RV-05-001 | Major | x | 保留 | C-002 で対応 |'), 'r'), []);
  assert.equal(reviewProblems(null, 'RV-05').length, 1);
});

test('トレーサビリティ: 欠落を検出する', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  assert.deepEqual(traceProblems(buildTrace(root, CYCLE), 'red'), []);
  // Must 要求を追加したのに設計・テストがない
  write(root, `${D}/01_requirements.md`, REQ_DOC + '\n### REQ-002: 削除\n- 優先度: Must\n- 受入基準:\n  - AC-002-1: 消える\n');
  const p = traceProblems(buildTrace(root, CYCLE), 'red');
  assert.ok(p.some((x) => x.includes('REQ-002')));
  assert.ok(p.some((x) => x.includes('AC-002-1')));
});

test('トレーサビリティ: テストコードにない TC・未定義 ID を検出する', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  write(root, `${D}/03_test_plan.md`, '| TC | 対応 |\n|---|---|\n| TC-001 | AC-001-1 |\n| TC-002 | AC-009-1 |\n');
  const p = traceProblems(buildTrace(root, CYCLE), 'red');
  assert.ok(p.some((x) => x.includes('TC-002') && x.includes('テストコードにありません')));
  assert.ok(p.some((x) => x.includes('AC-009-1')));
});

test('コミット規約', () => {
  assert.deepEqual(checkCommitMessage('feat(C-001): 追加\n\nRefs: REQ-001, TC-001'), []);
  assert.equal(checkCommitMessage('feat(C-001): 追加').length, 1);
  assert.deepEqual(checkCommitMessage('chore(C-001): gate RED passed'), []);
  assert.deepEqual(checkCommitMessage('docs(platform): 設計メモ'), []);
  assert.equal(checkCommitMessage('いろいろ修正').length, 1);
  assert.deepEqual(checkCommitMessage("Merge branch 'wp/C-001/WP-01'"), []);
  assert.deepEqual(checkCommitMessage('Merge d9eddefcd64fc3f329e0cb69c5477b8d873b9f33 into a51943e1e109a83314472e0031da6c4346e0f02d'), []);
});

test('トレーサビリティ: 前のサイクルのテスト（TC・AC）は今のサイクルの判定に混ざらない', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  assert.deepEqual(traceProblems(buildTrace(root, CYCLE), 'red'), []);
  // 前のサイクルが REQ-009 / AC-009-1 / TC-009 を定義し、そのテストが src にある
  const prev = 'docs/cycles/C-000-prev';
  write(root, `${prev}/01_requirements.md`, '# 要求\n\n### REQ-009: 前のサイクルの要求\n- 優先度: Must\n- 受入基準:\n  - AC-009-1: 動く\n');
  write(root, `${prev}/03_test_plan.md`, '# テスト計画\n\n| TC | 名称 | 対応 |\n|---|---|---|\n| TC-009 | 前のテスト | AC-009-1 |\n');
  write(root, 'src/legacy.test.ts', "test('[TC-009][AC-009-1] 前のサイクルのテスト', () => {});\n");
  assert.deepEqual(traceProblems(buildTrace(root, CYCLE), 'red'), []);
  // 前のサイクルが定義していない TC・AC は、従来どおり今のサイクルの不整合として検出する
  write(root, 'src/stray.test.ts', "test('[TC-777][AC-777-1] どこにも定義がない', () => {});\n");
  const p = traceProblems(buildTrace(root, CYCLE), 'red');
  assert.ok(p.some((x) => x.includes('TC-777')));
  assert.ok(p.some((x) => x.includes('AC-777-1')));
});

test('トレーサビリティ: ID が前のサイクルと重なったら不合格（別物が紐づくのを防ぐ）', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const prev = 'docs/cycles/C-000-prev';
  write(root, `${prev}/01_requirements.md`, REQ_DOC);
  write(root, `${prev}/03_test_plan.md`, '# テスト計画\n\n| TC | 名称 | 対応 |\n|---|---|---|\n| TC-001 | 前のテスト | AC-001-1 |\n');
  const p = traceProblems(buildTrace(root, CYCLE), 'red');
  assert.ok(p.some((x) => x.includes('REQ-001') && x.includes('C-000-prev') && x.includes('一意')), p.join('\n'));
  assert.ok(p.some((x) => x.includes('TC-001') && x.includes('C-000-prev')), p.join('\n'));
});
