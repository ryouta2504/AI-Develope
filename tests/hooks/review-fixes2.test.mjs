// RV-PF 2 回目の指摘（023 / 024 / 026 / 029 / 030 / 013）への対応のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, toPhase, write, record, CYCLE } from './helpers.mjs';
import { SKIP_RE, parseReview } from '../../scripts/lib/ids.mjs';
import { deriveState, rejectGate, computeArtifacts } from '../../scripts/lib/state.mjs';

describe('RV-PF-024: skip 系の検出', () => {
  for (const c of ["test.fixme('[TC-001] x', () => {})", "it.skipIf(cond)('[TC-001] x', () => {})", "it.runIf(cond)('x', () => {})", "it.fails('[TC-001] x', () => {})", "test.describe.skip('x', () => {})", "it.concurrent.skip('x', () => {})"]) {
    test(`検出する: ${c}`, () => assert.match(c, SKIP_RE));
  }
  test('通常のテストは検出しない', () => assert.doesNotMatch("it('[TC-001] x', () => {})\ndescribe('a', () => {})", SKIP_RE));
});

describe('RV-PF-013: RV-PF の指摘 ID を認識する', () => {
  test('parseReview が RV-PF-001 を ID として読む', () => {
    const t = '| 指摘 ID | 重大度 | 内容 | 状態 | 対応 |\n|---|---|---|---|---|\n| RV-PF-001 | Critical | x | 対応済 | abc123 |\n';
    assert.equal(parseReview(t).findings[0].id, 'RV-PF-001');
  });
});

describe('RV-PF-026: 差し戻しは、それ以降のゲートをすべて無効にする', () => {
  test('G1 を差し戻し、成果物を変えずに G1 を再承認しても、G2 以降は有効に戻らない', () => {
    const root = makeProject();
    toPhase(root, 'final_review');
    rejectGate(root, CYCLE, 'G1', { by: 'tester', reason: 'やり直し' });
    record(root, CYCLE, 'G1'); // 成果物は変えずに再承認
    const s = deriveState(root);
    assert.notEqual(s.phase, 'final_review');
    for (const id of ['G2', 'RED', 'GREEN', 'CODE_REVIEW', 'G3']) assert.equal(s.steps.find((x) => x.id === id).valid, false, `${id} は無効のまま`);
  });
});

describe('RV-PF-029: GREEN 以降のハッシュに index.html と package.json を含む', () => {
  test('GREEN 後に index.html を変えると GREEN が無効になる', () => {
    const root = makeProject();
    write(root, 'index.html', '<html></html>');
    toPhase(root, 'ai_review');
    assert.ok('file:index.html' in computeArtifacts(root, CYCLE, 'GREEN'));
    write(root, 'index.html', '<html><script src="x"></script></html>');
    assert.equal(deriveState(root).steps.find((x) => x.id === 'GREEN').valid, false);
  });
});
