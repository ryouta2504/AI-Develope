// RV-PF 2 回目の指摘（023 / 024 / 026 / 029 / 030 / 013）への対応のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { traceProblems } from '../../scripts/lib/trace.mjs';
import { checkWrite, commandWriteTargets } from '../../scripts/lib/policy.mjs';
import { makeProject, toPhase, write, record, CYCLE } from './helpers.mjs';
import { SKIP_RE, parseReview, parseRequirements, reviewProblems } from '../../scripts/lib/ids.mjs';
import { deriveState, rejectGate, computeArtifacts, writeRecord } from '../../scripts/lib/state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

describe('RV-PF-010: シェルからの書き込み先（作成者の記録）が checkBash と同じ規則で抽出される', () => {
  const cwd = process.cwd();
  const targets = (c) => commandWriteTargets(c, cwd).map((p) => path.relative(cwd, p).split(path.sep).join('/'));
  test('VAR=x・sudo・env を除いて書き込み先を取る', () => {
    assert.deepEqual(targets('FOO=1 echo x > a.txt'), ['a.txt']);
    assert.deepEqual(targets('sudo tee b.txt'), ['b.txt']);
    assert.ok(targets('env FOO=1 cp x c.txt').includes('c.txt'));
  });
  test('bash -c の中の書き込み先も取る', () => {
    assert.deepEqual(targets('bash -c "echo x > d.txt"'), ['d.txt']);
  });
  test('~ を展開する', () => {
    assert.ok(commandWriteTargets('echo x > ~/e.txt', cwd)[0].startsWith(os.homedir()));
  });
});

describe('RV-PF-027: RED 再オープン後に、誤ったテストを削除しただけでも進める', () => {
  test('削除のみの再オープンは「変更されたテストがありません」で止まらず、再オープン記録も残らない', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    // RED の記録だけ消し、ロック時には存在した src/old.test.ts を削除した状態を作る
    const prev = { ...computeArtifacts(root, CYCLE, 'RED'), 'file:src/old.test.ts': 'x' };
    fs.rmSync(path.join(root, '.ai-dev', 'cycles', CYCLE, 'gates', 'RED.json'), { force: true });
    writeRecord(root, CYCLE, 'RED_REOPEN', { step: 'RED_REOPEN', status: 'reopened', at: new Date().toISOString(), by: 'human', reason: 'x', previousLock: prev });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'chore: setup'], { cwd: root });
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'gate.mjs'), 'RED'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev', 'cycles', CYCLE, 'gates', 'RED_REOPEN.json')));
    assert.equal(execFileSync('git', ['status', '--porcelain', '--', '.ai-dev'], { cwd: root, encoding: 'utf8' }).trim(), '', '未コミットの変更が残らない');
  });
});

describe('RV-PF-053 / 054: 優先度・レビュー記録の判定', () => {
  test('見出しに英単語 should があっても、「優先度: Must」を優先する', () => {
    const { reqs } = parseRequirements('### REQ-001: ユーザーは追加できる（should be fast）\n- 優先度: Must\n- 受入基準:\n  - AC-001-1: x\n');
    assert.equal(reqs.get('REQ-001').priority, 'Must');
  });
  test('想定外の重大度は問題になる', () => {
    const t = '| 指摘 ID | 重大度 | 内容 | 状態 | 対応 |\n|---|---|---|---|---|\n| RV-05-001 | 重大 | x | 未対応 | - |\n';
    assert.match(reviewProblems(t, 'RV-05').join(), /重大度「重大」/);
  });
  test('「指摘なし」は単独の行だけ有効（本文中の言及では表なしの記録を通さない）', () => {
    assert.ok(reviewProblems('# レビュー\n指摘なし\n', 'RV').length === 0);
    assert.ok(reviewProblems('# レビュー\n前回は指摘なしだったが今回は多数ある\n', 'RV').length > 0);
  });
});
