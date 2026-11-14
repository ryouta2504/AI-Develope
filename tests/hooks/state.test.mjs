// 状態算出のテスト: フェーズはゲート記録と成果物ハッシュから決まる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, nextAction } from '../../scripts/lib/state.mjs';
import { makeProject, toPhase, write, record, CYCLE, REQ_DOC } from './helpers.mjs';

const D = `docs/cycles/${CYCLE}`;

test('G0 がなければ planning', () => {
  const root = makeProject();
  assert.equal(deriveState(root).phase, 'planning');
});

test('G0 承認後・サイクルなしなら idle', () => {
  const root = makeProject();
  toPhase(root, 'idle');
  assert.equal(deriveState(root).phase, 'idle');
});

for (const phase of ['requirements', 'design', 'test_design', 'implementation', 'ai_review', 'final_review', 'done']) {
  test(`toPhase(${phase}) → ${phase}`, () => {
    const root = makeProject();
    toPhase(root, phase);
    assert.equal(deriveState(root).phase, phase);
  });
}

test('承認後に要求定義が変わると、承認が無効になりフェーズが戻る', () => {
  const root = makeProject();
  toPhase(root, 'test_design');
  write(root, `${D}/01_requirements.md`, REQ_DOC + '\n### REQ-002: 追加\n');
  const s = deriveState(root);
  assert.equal(s.phase, 'requirements');
  assert.equal(s.blockingStep.id, 'REQ_REVIEW');
  assert.match(nextAction(s), /記録後に変更あり/);
});

test('改行コードの違い（CRLF/LF）では無効にならない', () => {
  const root = makeProject();
  toPhase(root, 'design');
  write(root, `${D}/01_requirements.md`, REQ_DOC.replace(/\n/g, '\r\n'));
  assert.equal(deriveState(root).phase, 'design');
});

test('差し戻すと、そのゲートで止まる', () => {
  const root = makeProject();
  toPhase(root, 'design');
  write(root, `${D}/02_design.md`, '# 設計\n');
  write(root, `${D}/reviews/RV-02_design.md`, '# r\n');
  record(root, CYCLE, 'DESIGN_REVIEW');
  record(root, CYCLE, 'G2', 'rejected');
  const s = deriveState(root);
  assert.equal(s.phase, 'design');
  assert.equal(s.blockingStep.id, 'G2');
  assert.match(nextAction(s), /差し戻し/);
});

test('実装後に src が変わると GREEN が無効になる', () => {
  const root = makeProject();
  toPhase(root, 'ai_review');
  write(root, 'src/features/add/AddForm.tsx', 'export const AddForm = () => 1;\n');
  assert.equal(deriveState(root).phase, 'implementation');
});
