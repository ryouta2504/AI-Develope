// RV-PF（テンプレートの相互レビュー）1 回目の指摘に対する修正の回帰テスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkWrite, checkBash, scaffoldContentProblem } from '../../scripts/lib/policy.mjs';
import { deriveState, rejectGate } from '../../scripts/lib/state.mjs';
import { reviewProblems } from '../../scripts/lib/ids.mjs';
import { checkReviewRequest, readTranscript } from '../../scripts/lib/review-evidence.mjs';
import { buildTrace, traceProblems } from '../../scripts/lib/trace.mjs';
import { makeProject, toPhase, write, abs, CYCLE } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = `docs/cycles/${CYCLE}`;
const bash = (root, command, agentType = 'implementer', branch = `cycle/${CYCLE}`) => checkBash({ root, command, cwd: root, agentType, branch });
const wr = (root, rel, agentType, extra = {}) => checkWrite({ root, absPath: path.isAbsolute(rel) ? rel : abs(root, rel), agentType, branch: `cycle/${CYCLE}`, ...extra });
const ng = (r, m) => assert.equal(r.allow, false, `${m}: ブロックされるべき`);
const ok = (r, m) => assert.equal(r.allow, true, `${m}: 許可されるべき（${r.reason}）`);

describe('Critical 1: シェル経由の迂回', () => {
  const root = makeProject();
  toPhase(root, 'design');
  for (const c of [
    'bash -c "echo x > .ai-dev/current.json"',
    "sh -c 'cp x .ai-dev/approvals/G0.json'",
    'cmd /c "echo x > .ai-dev\\current.json"',
    'powershell -Command "Set-Content -Path .ai-dev/current.json -Value 1"',
    'eval "echo x > .ai-dev/current.json"',
    'cd .ai-dev && echo x > current.json',
    'cd src && echo x > App.tsx',
    'ln -s .ai-dev link',
    'cmd /c mklink /J link .ai-dev',
    'New-Item -ItemType Junction -Path link -Target .ai-dev',
  ]) {
    test(`ブロック: ${c}`, () => ng(bash(root, c), c));
  }
  test('ジャンクション経由の書き込みは実体のパスで判定する', () => {
    fs.symlinkSync(path.join(root, '.ai-dev'), path.join(root, 'lnk'), process.platform === 'win32' ? 'junction' : 'dir');
    ng(wr(root, 'lnk/current.json'), 'lnk/current.json');
  });
  test('人間専用スクリプトは「読む」のは可、「実行」は不可', () => {
    ok(bash(root, 'cat scripts/approve.mjs'), 'cat');
    ng(bash(root, 'node scripts/approve.mjs G1'), 'node');
    ng(bash(root, 'npm run approve -- G1'), 'npm run');
  });
  test('未分類の場所に実行可能なスクリプトは誰も置けない', () => {
    ng(wr(root, 'tools/x.mjs', 'implementer'), 'implementer');
    ng(wr(root, 'tools/x.mjs'), 'main');
    ng(wr(root, 'notes.txt'), 'main も未分類には書けない（RV-PF-017: PM の書き場所は plan・improvements・debt・tasks・retro・memo）');
    ok(wr(root, 'docs/memo/notes.txt'), 'main は docs/memo に書ける');
    ng(wr(root, 'notes.txt', 'implementer'), '役割外の未分類ファイル');
  });
});

describe('Critical 4: ツール設定・プロジェクト外', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  for (const f of ['.npmrc', '.mcp.json', '.gitignore', 'README.md', '.vscode/settings.json', 'docs/memo/01_platform_design.md']) {
    test(`保護: ${f}`, () => ng(wr(root, f), f));
  }
  test('プロジェクト外（~/.claude/settings.json）には書けない', () => ng(wr(root, path.join(os.homedir(), '.claude', 'settings.json')), 'home'));
  test('OS の一時ディレクトリには書ける', () => ok(wr(root, path.join(os.tmpdir(), 'aidev-tmp.txt')), 'tmp'));
  test('ビルド成果物（node_modules など）はどの役割でも消せる', () => ok(bash(root, 'rm -rf node_modules dist'), 'rm node_modules'));
});

describe('Critical 5: Windows のパス表記', { skip: process.platform !== 'win32' }, () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  test('末尾のドット（scripts./x.mjs）でも保護される', () => ng(wr(root, 'scripts./gate.mjs'), 'trailing dot'));
  test('代替データストリームは書けない', () => ng(wr(root, 'src/features/add/AddForm.tsx:hidden', 'implementer'), 'ADS'));
  test('大文字小文字が違っても保護される', () => ng(wr(root, 'SCRIPTS/gate.mjs'), 'case'));
});

describe('Critical 6: G3 の差し戻し', () => {
  test('G3 を差し戻すと implementation に戻り、コードを直せる', () => {
    const root = makeProject();
    toPhase(root, 'final_review');
    rejectGate(root, CYCLE, 'G3', { by: 'tester', reason: '動作が仕様と違う' });
    const s = deriveState(root);
    assert.equal(s.phase, 'implementation');
    ok(wr(root, 'src/features/add/AddForm.tsx', 'implementer'), 'implementer が修正できる');
  });
  test('G2 を差し戻すと設計レビューもやり直しになる', () => {
    const root = makeProject();
    toPhase(root, 'test_design');
    rejectGate(root, CYCLE, 'G2', { by: 'tester', reason: 'x' });
    const s = deriveState(root);
    assert.equal(s.phase, 'design');
    assert.equal(s.blockingStep.id, 'DESIGN_REVIEW');
  });
});

describe('Major: GitHub の操作・レビューの抜け穴', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  for (const c of [
    "gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:\"x\"}) { clientMutationId } }'",
    'gh api repos/o/r/pulls/1/merge -f merge_method=merge',
    'gh api repos/o/r/pulls/1/reviews -f event=APPROVE',
    'curl -X PUT -H "Authorization: token x" https://api.github.com/repos/o/r/pulls/1/merge',
  ]) {
    test(`ブロック: ${c.slice(0, 50)}`, () => ng(bash(root, c, undefined), c));
  }
  test('レビューの基準に作業の経緯（tasks）を指定できない', () => {
    const r2 = makeProject();
    toPhase(r2, 'requirements');
    write(r2, `${D}/tasks/T-001.md`, '経緯');
    const r = checkReviewRequest({ root: r2, prompt: `レビュー番号: RV-01\n観点: 実現可能性\n対象: ${D}/01_requirements.md\n基準: ${D}/tasks/T-001.md`, state: deriveState(r2) });
    ng(r, 'tasks');
  });
  test('システムの注記が前に付いた指示文も読み取れる', () => {
    const f = path.join(root, 't.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'user', message: { content: '<system-reminder>注記</system-reminder>\nレビュー番号: RV-05\n観点: 保守性\n対象: src\n基準: README.md' } }));
    const t = readTranscript(f);
    assert.equal(t.prompts.length, 1);
    assert.match(t.prompts[0], /^レビュー番号: RV-05/);
  });
  test('「状態」列のない指摘表でも Critical を見逃さない', () => {
    assert.equal(reviewProblems('| 指摘 ID | 重大度 | 内容 |\n|---|---|---|\n| RV-05-001 | Critical | x |', 'r').length, 1);
    assert.equal(reviewProblems('# レビュー\n本文だけ', 'r').length, 1);
    assert.deepEqual(reviewProblems('# レビュー\n指摘なし', 'r'), []);
  });
});

describe('Major: TDD の抜け道', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  test('index.ts にロジックは書けない', () => {
    assert.ok(scaffoldContentProblem('src/a/index.ts', 'export const add = (a, b) => a + b;'));
    assert.equal(scaffoldContentProblem('src/a/index.ts', "export { A } from './A';\nexport * from './B';"), null);
  });
  test('types.ts に関数は書けない', () => {
    assert.ok(scaffoldContentProblem('src/a/types.ts', 'export function f() {}'));
    assert.equal(scaffoldContentProblem('src/a/types.ts', 'export type Todo = { id: string };\nexport interface X { a: number }'), null);
  });
  test('アサーションのないテストは書けない', () => {
    ng(wr(root, 'src/features/add/New.test.tsx', 'implementer', { newText: "it('[TC-009] x', () => { render(<A/>) })" }), 'no expect');
    ok(wr(root, 'src/features/add/New.test.tsx', 'implementer', { newText: "it('[TC-009] x', () => { expect(1).toBe(1) })" }), 'expect');
  });
  test('GREEN: 実行結果のない TC（E2E など）は不合格', () => {
    const p = traceProblems(buildTrace(root, CYCLE), 'green');
    assert.ok(p.some((x) => x.includes('TC-001') && x.includes('実行結果がありません')));
  });
});

describe('Major: MCP ツール', () => {
  const hook = (input) => spawnSync(process.execPath, [path.join(REPO, '.claude', 'hooks', 'guard-mcp.mjs')], { input: JSON.stringify(input), encoding: 'utf8' });
  const root = makeProject();
  test('書き込み系の MCP ツールは止まる', () => assert.equal(hook({ tool_name: 'mcp__filesystem__write_file', cwd: root }).status, 2));
  test('読み取り系の MCP ツールは通る', () => assert.equal(hook({ tool_name: 'mcp__filesystem__read_file', cwd: root }).status, 0));
  test('mcpAllow に登録すれば通る', () => {
    write(root, '.ai-dev/config.json', JSON.stringify({ mcpAllow: ['^mcp__filesystem__write_file$'] }));
    assert.equal(hook({ tool_name: 'mcp__filesystem__write_file', cwd: root }).status, 0);
  });
});
