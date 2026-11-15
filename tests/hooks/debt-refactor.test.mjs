// 技術的負債の台帳とリファクタリングサイクル
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, toPhase, write } from './helpers.mjs';
import { parseDebt, debtProblems, debtSummary, isRefactorCycle, refactorTargets, refactorDebtProblems } from '../../scripts/lib/debt.mjs';
import { statusLines } from '../../scripts/lib/statusview.mjs';
import { checkWrite } from '../../scripts/lib/policy.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = (cwd, name, args = []) => spawnSync(process.execPath, [path.join(REPO, 'scripts', name), ...args], { cwd, encoding: 'utf8' });
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const HEAD = '| ID | 内容 | 場所 | 重大度 | 起票元 | 状態 | 解消サイクル / 理由 |\n|---|---|---|---|---|---|---|\n';
const row = (id, o = {}) => `| ${id} | ${o.title ?? '重複した検証'} | ${o.place ?? 'src/a.ts'} | ${o.sev ?? '中'} | ${o.src ?? 'RV-05-003'} | ${o.status ?? '未対応'} | ${o.note ?? ''} |\n`;

describe('台帳の書式', () => {
  test('正しい行は問題なし。表の見出し行は無視する', () => {
    const t = HEAD + row('DEBT-001') + row('DEBT-002', { status: '解消', note: 'C-002-refactor-x' }) + row('DEBT-003', { status: '却下', note: '対象外になった' });
    assert.equal(parseDebt(t).length, 3);
    assert.deepEqual(debtProblems(t), []);
  });
  test('重複・不正な状態と重大度・起票元なし・解消にサイクルなし・却下に理由なし を検出する', () => {
    const t = HEAD + row('DEBT-001') + row('DEBT-001') + row('DEBT-002', { status: '保留' }) + row('DEBT-003', { sev: '大' }) + row('DEBT-004', { src: '' }) + row('DEBT-005', { status: '解消' }) + row('DEBT-006', { status: '却下' });
    const p = debtProblems(t).join('\n');
    for (const m of ['重複', '状態は', '重大度は', '起票元', '解消したサイクル', '理由が必要']) assert.match(p, new RegExp(m));
  });
  test('未解消が閾値以上、または重大度「高」があると、リファクタリングを促す', () => {
    const root = makeProject();
    write(root, 'docs/debt.md', HEAD + row('DEBT-001') + row('DEBT-002'));
    assert.equal(debtSummary(root, 5).needsRefactor, false);
    assert.equal(debtSummary(root, 2).needsRefactor, true);
    write(root, 'docs/debt.md', HEAD + row('DEBT-001', { sev: '高' }));
    assert.equal(debtSummary(root, 5).needsRefactor, true);
    assert.match(statusLines(root).join('\n'), /リファクタリングサイクルを計画/);
  });
  test('PM は台帳をフェーズに関係なく更新できる。reviewer や implementer は更新できない', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    const state = deriveState(root);
    const w = (agentType) => checkWrite({ root, absPath: path.join(root, 'docs/debt.md'), agentType, state, branch: 'cycle/C-001-test' });
    assert.equal(w(undefined).allow, true);
    assert.equal(w('implementer').allow, false);
    assert.equal(w('reviewer').allow, false);
  });
});

describe('リファクタリングサイクル', () => {
  test('サイクル名の接頭辞で判別する', () => {
    assert.ok(isRefactorCycle('C-003-refactor-validation'));
    assert.ok(!isRefactorCycle('C-003-todo-basic'));
  });
  test('要求定義から対象の負債を読む', () => {
    assert.deepEqual(refactorTargets('対象の負債: DEBT-001, DEBT-004\n'), ['DEBT-001', 'DEBT-004']);
    assert.deepEqual(refactorTargets('なし'), []);
  });
  test('cycle:new --refactor は --debt が必須で、未解消の負債だけを対象にできる', () => {
    const root = makeProject({ branch: 'main' });
    toPhase(root, 'idle');
    write(root, 'docs/debt.md', HEAD + row('DEBT-001') + row('DEBT-002', { status: '解消', note: 'C-001-x' }));
    fs.cpSync(path.join(REPO, 'docs', 'templates'), path.join(root, 'docs', 'templates'), { recursive: true });
    g(root, 'add', '-A');
    g(root, 'commit', '-q', '-m', 'chore: setup');
    assert.equal(script(root, 'cycle.mjs', ['new', '--refactor', 'v']).status, 1);
    assert.match(script(root, 'cycle.mjs', ['new', '--refactor', '--debt', 'DEBT-999', 'v']).stderr, /にありません/);
    assert.match(script(root, 'cycle.mjs', ['new', '--refactor', '--debt', 'DEBT-002', 'v']).stderr, /未対応・計画済/);
    const r = script(root, 'cycle.mjs', ['new', '--refactor', '--debt', 'DEBT-001', 'validation']);
    assert.equal(r.status, 0, r.stderr);
    const cycle = deriveState(root).cycle;
    assert.equal(cycle, 'C-001-refactor-validation');
    const req = fs.readFileSync(path.join(root, `docs/cycles/${cycle}/01_requirements.md`), 'utf8');
    assert.match(req, /対象の負債: DEBT-001/);
    assert.match(req, /振る舞いが変わらない/);
    // 対象の負債が未解消の間は完了条件を満たさない。「解消」にしてサイクル ID を書くと満たす
    assert.match(refactorDebtProblems(root, cycle).join(), /DEBT-001/);
    write(root, 'docs/debt.md', HEAD + row('DEBT-001', { status: '解消', note: cycle }));
    assert.deepEqual(refactorDebtProblems(root, cycle), []);
  });
  test('npm run debt -- --check は書式の問題で終了コード 1', () => {
    const root = makeProject();
    write(root, 'docs/debt.md', HEAD + row('DEBT-001', { status: '解消' }));
    assert.equal(script(root, 'debt.mjs', ['--check']).status, 1);
  });
});
