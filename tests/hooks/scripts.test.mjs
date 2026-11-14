// スクリプト（cycle:new / wp:start / wp:merge / pr:create --dry-run）を実際に動かす結合テスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, toPhase, write, record, CYCLE } from './helpers.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = (cwd, name, args = []) => spawnSync(process.execPath, [path.join(REPO, 'scripts', name), ...args], { cwd, encoding: 'utf8' });
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commitAll = (root, msg = 'chore: setup') => {
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', msg);
};
const passingConfig = (root) =>
  write(root, '.ai-dev/config.json', JSON.stringify({ requireReviewEvidence: false, green: ['test', 'lint', 'typecheck'], commands: { test: 'node -e ""', testReport: '', lint: 'node -e ""', typecheck: 'node -e ""' } }));

describe('cycle:new', () => {
  test('G0 承認後に、統合ブランチから cycle ブランチと成果物フォルダを作る', () => {
    const root = makeProject({ branch: 'main' });
    toPhase(root, 'idle');
    commitAll(root);
    const r = script(root, 'cycle.mjs', ['new', 'todo-basic']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(g(root, 'branch', '--show-current'), 'cycle/C-001-todo-basic');
    assert.equal(deriveState(root).cycle, 'C-001-todo-basic');
    assert.ok(fs.existsSync(path.join(root, 'docs/cycles/C-001-todo-basic/reviews')));
  });
  test('G0 がなければ開始できない', () => {
    const root = makeProject({ branch: 'main' });
    commitAll(root);
    const r = script(root, 'cycle.mjs', ['new', 'x']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /G0/);
  });
  test('git-flow-lite で develop がなければ、人間に作成を求める。develop があればそこから分岐する', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'docs/plan.md', '# 計画\n\n```json ai-dev:branching\n{ "strategy": "git-flow-lite" }\n```\n');
    record(root, null, 'G0');
    commitAll(root);
    const r = script(root, 'cycle.mjs', ['new', 'x']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /develop/);
    g(root, 'branch', 'develop');
    const r2 = script(root, 'cycle.mjs', ['new', 'x']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /分岐元: develop/);
  });
});

describe('wp:start / wp:merge（並列実装の worktree）', () => {
  test('worktree を作り、GREEN を確認して 1 つずつマージし、作成者の記録も引き継ぐ', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    passingConfig(root);
    commitAll(root);
    const wt = path.resolve(root, '..', `${path.basename(root)}.worktrees`, 'C-001-WP-01');

    const s = script(root, 'wp.mjs', ['start', 'WP-01']);
    assert.equal(s.status, 0, s.stderr);
    assert.ok(fs.existsSync(wt));
    assert.equal(g(wt, 'branch', '--show-current'), 'wp/C-001/WP-01');

    // implementer の作業（worktree 内）
    write(wt, 'src/features/add/AddForm.tsx', 'export const AddForm = () => "done";\n');
    write(wt, `.ai-dev/cycles/${CYCLE}/activity.jsonl`, JSON.stringify({ agent_id: 'impl-1', file: 'src/features/add/AddForm.tsx' }) + '\n');
    g(wt, 'add', 'src');
    g(wt, 'commit', '-q', '-m', 'feat(C-001): add form');

    // GREEN を通す前のマージは失敗し、ロックは残らない
    const early = script(root, 'wp.mjs', ['merge', 'WP-01']);
    assert.equal(early.status, 1);
    assert.equal(fs.existsSync(path.join(root, '.ai-dev/.cache/merge.lock')), false, 'ロックが残っている');

    assert.equal(script(wt, 'gate.mjs', ['wp', 'WP-01']).status, 0);
    const m = script(root, 'wp.mjs', ['merge', 'WP-01']);
    assert.equal(m.status, 0, m.stderr);
    assert.match(fs.readFileSync(path.join(root, 'src/features/add/AddForm.tsx'), 'utf8'), /done/);
    assert.match(fs.readFileSync(path.join(root, `.ai-dev/cycles/${CYCLE}/activity.jsonl`), 'utf8'), /impl-1/);
    assert.equal(fs.existsSync(wt), false, 'worktree が削除されていない');
  });
  test('計画で並列実装を使わない方針なら wp:start できない', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    write(root, 'docs/plan.md', '# 計画\n\n```json ai-dev:branching\n{ "strategy": "github-flow", "parallelWorktrees": false }\n```\n');
    record(root, null, 'G0'); // 計画を変えたので G0 を取り直す
    commitAll(root);
    const r = script(root, 'wp.mjs', ['start', 'WP-01']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /並列実装/);
  });
});

describe('pr:create --dry-run', () => {
  test('final_review で PR 本文（トレーサビリティ・レビュー・承認記録）を生成する', () => {
    const root = makeProject();
    toPhase(root, 'final_review');
    fs.mkdirSync(path.join(root, 'docs/templates'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'docs/templates/pr_body.md'), path.join(root, 'docs/templates/pr_body.md'));
    commitAll(root);
    const r = script(root, 'pr.mjs', ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    const body = fs.readFileSync(path.join(root, '.ai-dev/.cache/pr_body.md'), 'utf8');
    assert.match(body, /C-001-test/);
    assert.match(body, /REQ-001/);
    assert.match(body, /相互レビューの実施記録/);
    assert.match(body, /github-flow/);
  });
  test('final_review 以外では作れない', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    assert.equal(script(root, 'pr.mjs', ['--dry-run']).status, 1);
  });
});
