// RV-PF 2 回目の指摘（023 / 024 / 026 / 029 / 030 / 013）への対応のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { traceProblems } from '../../scripts/lib/trace.mjs';
import { checkWrite } from '../../scripts/lib/policy.mjs';
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

describe('RV-PF-025: 孤立 ID の検出', () => {
  const t = {
    reqs: new Map([['REQ-001', { id: 'REQ-001', priority: 'Must', acs: ['AC-001-1'] }]]),
    desDefs: new Map([['DES-001', { refs: new Set() }], ['WP-01', { refs: new Set(['DES-001']) }]]),
    tcDefs: new Map([['TC-001', { refs: new Set() }]]),
    codeTc: new Map([['TC-001', ['a.test.ts']]]),
    codeAc: new Map([['AC-009-9', ['a.test.ts']]]),
    defined: new Set(['REQ-001', 'AC-001-1', 'DES-001', 'WP-01', 'TC-001']),
    rows: [{ req: 'REQ-001', priority: 'Must', ac: 'AC-001-1', des: ['DES-001'], tcs: ['TC-001'] }],
    results: new Map(),
  };
  test('要求を参照しない DES を指摘する', () => assert.match(traceProblems(t, 'design').join('\n'), /DES-001 は要求.*参照していません/));
  test('AC を参照しない TC と、テストコード内の未定義 AC を指摘する', () => {
    const p = traceProblems(t, 'red').join('\n');
    assert.match(p, /TC-001 は受入基準/);
    assert.match(p, /AC-009-9 はテストコード/);
  });
});

describe('RV-PF-016: done でも PM は計画を直せる', () => {
  test('done フェーズで docs/plan.md を書ける（implementer は書けない）', () => {
    const root = makeProject();
    toPhase(root, 'done');
    const w = (agentType) => checkWrite({ root, absPath: path.join(root, 'docs/plan.md'), agentType, state: deriveState(root), branch: `cycle/${CYCLE}` });
    assert.equal(w(undefined).allow, true);
    assert.equal(w('implementer').allow, false);
  });
});
