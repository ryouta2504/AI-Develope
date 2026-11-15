// RV-PF 2 回目の指摘（007 / 018 / 019 / 021 / 022）への対応のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLATFORM, isPlatformFile } from '../../scripts/lib/config.mjs';
import { checkReviewRequest, exactReviewNumber } from '../../scripts/lib/review-evidence.mjs';
import { checkBash, checkWrite } from '../../scripts/lib/policy.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { makeProject, toPhase, write, CYCLE } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('RV-PF-007: CODEOWNERS が PLATFORM と一致している', () => {
  const owners = fs.readFileSync(path.join(REPO, '.github', 'CODEOWNERS'), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/)[0]);
  const expected = (g) => (g.endsWith('/**') ? `/${g.slice(0, -2)}` : g.startsWith('**/') ? g : `/${g}`);
  for (const g of PLATFORM) test(`${g} にコードオーナーがいる`, () => assert.ok(owners.includes(expected(g)), `${expected(g)} が CODEOWNERS にありません`));
  test('.ai-dev/config.json と package.json（scripts）も対象', () => {
    assert.ok(owners.includes('/.ai-dev/') || owners.includes('/.ai-dev/config.json'));
    assert.ok(owners.includes('/package.json'));
  });
});

describe('RV-PF-019: どの階層の CLAUDE.md もテンプレートとして保護する', () => {
  for (const f of ['CLAUDE.md', 'CLAUDE.local.md', 'docs/memo/CLAUDE.md', 'src/features/CLAUDE.md', 'src/CLAUDE.local.md']) test(`${f} は保護される`, () => assert.ok(isPlatformFile(f)));
  test('implementer は src/**/CLAUDE.md を書けない', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    const r = checkWrite({ root, absPath: path.join(root, 'src/CLAUDE.md'), agentType: 'implementer', state: deriveState(root), branch: `cycle/${CYCLE}` });
    assert.equal(r.allow, false);
  });
});

describe('RV-PF-021: MCP ツールは読み取り専用と言える名前だけ許可', () => {
  const run = (tool) => spawnSync(process.execPath, [path.join(REPO, '.claude', 'hooks', 'guard-mcp.mjs')], { input: JSON.stringify({ tool_name: `mcp__srv__${tool}`, cwd: REPO }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } }).status;
  for (const t of ['get_file', 'list_issues', 'read_doc', 'search_code']) test(`許可: ${t}`, () => assert.equal(run(t), 0));
  for (const t of ['find_and_replace', 'search_and_replace', 'query', 'fetch', 'update_status', 'delete_list', 'get_and_delete', 'createIssue', 'sendMessage']) test(`拒否: ${t}`, () => assert.equal(run(t), 2));
});

describe('RV-PF-022: git の設定でフック・push 先を変えられない', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const run = (command) => checkBash({ root, command, cwd: root, branch: `cycle/${CYCLE}`, agentType: 'implementer' });
  for (const c of ["git config remote.origin.push '+refs/heads/*:refs/heads/*'", 'git config push.default matching', 'git config include.path ../x', 'git config branch.main.merge refs/heads/x', 'git -c core.hooksPath=/dev/null commit -m x', 'git -c push.default=matching push', 'npm run setup; git -c core.hooksPath=/dev/null commit -m x'])
    test(`拒否: ${c}`, () => assert.equal(run(c).allow, false));
  for (const c of ['git config --get user.name', 'git config --list', 'git config user.email']) test(`許可: ${c}`, () => assert.equal(run(c).allow, true, run(c).reason));
  test('npm run setup だけは許可', () => assert.equal(run('npm run setup').allow, true));
});

describe('RV-PF-018: 相互レビューに経緯を持ち込めない', () => {
  test('レビュー番号は完全一致（後ろに経緯を書けない）', () => {
    assert.equal(exactReviewNumber('RV-05'), 'RV-05');
    assert.equal(exactReviewNumber('RV-PF'), 'RV-PF');
    assert.equal(exactReviewNumber('RV-05 前回の指摘は修正済み'), null);
  });
  test('対象・基準に、自由に書けるメモや未分類のファイルは指定できない', () => {
    const root = makeProject({ branch: 'feature/x' });
    write(root, 'scripts/a.mjs', 'x');
    write(root, 'README.md', 'x');
    write(root, 'docs/memo/notes.md', '経緯');
    write(root, 'notes.md', '経緯');
    const st = deriveState(root);
    const req = (basis) => checkReviewRequest({ root, prompt: `レビュー番号: RV-PF\n観点: 保守性\n対象: scripts\n基準: ${basis}`, state: st, branch: 'feature/x' });
    assert.equal(req('README.md').allow, true);
    assert.equal(req('docs/memo/notes.md').allow, false);
    assert.equal(req('notes.md').allow, false);
  });
});
