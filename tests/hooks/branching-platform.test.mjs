// ブランチ戦略（docs/plan.md）と、基盤の変更に対する相互レビュー（RV-PF）のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadBranching, protectedBranches } from '../../scripts/lib/branching.mjs';
import { checkBash } from '../../scripts/lib/policy.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { checkReviewRequest, recordReviewRun, recordActivity, platformReviewProblems, changedPlatformFiles, platformReviewDoc } from '../../scripts/lib/review-evidence.mjs';
import { makeProject, toPhase, write, REVIEW_OK } from './helpers.mjs';

const plan = (json) => `# 計画\n\n## 5. ブランチ戦略\n\n\`\`\`json ai-dev:branching\n${json}\n\`\`\`\n`;
const g = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

describe('ブランチ戦略', () => {
  test('計画に書かれていなければ github-flow（main）', () => {
    const root = makeProject();
    const b = loadBranching(root);
    assert.equal(b.strategy, 'github-flow');
    assert.equal(b.base, 'main');
    assert.equal(b.source, 'default');
  });
  test('git-flow-lite を選ぶと develop が統合ブランチになり、保護される', () => {
    const root = makeProject();
    write(root, 'docs/plan.md', plan('{ "strategy": "git-flow-lite", "mergeMethod": "merge", "parallelWorktrees": false }'));
    const b = loadBranching(root);
    assert.equal(b.base, 'develop');
    assert.equal(b.release, 'main');
    assert.equal(b.parallelWorktrees, false);
    assert.deepEqual(protectedBranches(b).sort(), ['develop', 'main', 'master']);
  });
  test('git-flow-lite では develop への直接コミットも止まる', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    write(root, 'docs/plan.md', plan('{ "strategy": "git-flow-lite" }'));
    const r = checkBash({ root, command: 'git commit -m x', cwd: root, branch: 'develop' });
    assert.equal(r.allow, false);
  });
  test('不正な戦略名はエラーとして扱う', () => {
    const root = makeProject();
    write(root, 'docs/plan.md', plan('{ "strategy": "yolo" }'));
    assert.ok(loadBranching(root).error);
  });
});

/** main に基盤ファイルをコミットし、feature ブランチで変更した状態を作る */
function platformRepo() {
  const root = makeProject({ branch: 'main' });
  const cfg = path.join(root, '.ai-dev', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), requireReviewEvidence: true }));
  write(root, 'scripts/gate.mjs', '// v1\n');
  write(root, 'README.md', '# r\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'chore: init');
  g(root, 'switch', '-q', '-c', 'feature/x');
  write(root, 'scripts/gate.mjs', '// v2\n');
  write(root, '.claude/hooks/new.mjs', '// new\n');
  return root;
}

function transcript(root, prompt, reads) {
  const lines = [
    { type: 'user', message: { role: 'user', content: prompt } },
    ...reads.map((r) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(root, r) } }] } })),
  ];
  const f = path.join(root, '.git', `t-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  return f;
}
let n = 0;
const pf = (perspective, targets = 'scripts, .claude') => `レビュー番号: RV-PF\n観点: ${perspective}\n対象: ${targets}\n基準: README.md`;
const reviewPf = (root, perspective, targets, reads = ['scripts/gate.mjs', '.claude/hooks/new.mjs'], agentId = `pf${++n}`) =>
  recordReviewRun({ root, state: deriveState(root), input: { agent_id: agentId, agent_type: 'reviewer', agent_transcript_path: transcript(root, pf(perspective, targets), reads), last_assistant_message: '指摘なし' }, branch: 'feature/x' });
const ALL = ['ガードの抜け穴', 'ロジックの正しさ', 'ドキュメントとの整合', '保守性'];

describe('基盤の変更の相互レビュー（RV-PF）', () => {
  test('変更された基盤ファイルを検出する（README は対象外）', () => {
    const root = platformRepo();
    assert.deepEqual(changedPlatformFiles(root), ['.claude/hooks/new.mjs', 'scripts/gate.mjs']);
  });
  test('feature/* ブランチなら、サイクル外でも RV-PF の依頼ができる', () => {
    const root = platformRepo();
    const r = checkReviewRequest({ root, prompt: pf('ガードの抜け穴'), state: deriveState(root), branch: 'feature/x' });
    assert.equal(r.allow, true, r.reason);
  });
  test('cycle ブランチ（メンテナンスモードでない）では RV-PF はできない', () => {
    const root = platformRepo();
    const r = checkReviewRequest({ root, prompt: pf('ガードの抜け穴'), state: deriveState(root), branch: 'cycle/C-001-x' });
    assert.equal(r.allow, false);
  });
  test('レビューがなければ不合格、全観点＋指摘表がそろえば合格', () => {
    const root = platformRepo();
    assert.ok(platformReviewProblems(root, 'feature/x').length >= 4);
    for (const p of ALL) reviewPf(root, p, 'scripts, .claude');
    write(root, platformReviewDoc('feature/x'), REVIEW_OK.replace('RV-01-001', 'RV-PF-001'));
    assert.deepEqual(platformReviewProblems(root, 'feature/x'), []);
  });
  test('変更ファイルを対象に含めていない観点は無効', () => {
    const root = platformRepo();
    for (const p of ALL.slice(0, 3)) reviewPf(root, p, 'scripts, .claude');
    reviewPf(root, '保守性', 'scripts', ['scripts/gate.mjs']);
    write(root, platformReviewDoc('feature/x'), REVIEW_OK);
    const p = platformReviewProblems(root, 'feature/x');
    assert.equal(p.length, 1);
    assert.match(p[0], /保守性.*対象に含まれていない/);
  });
  test('レビュー後に基盤ファイルを変えると全観点が無効（再レビューが必要）', () => {
    const root = platformRepo();
    for (const p of ALL) reviewPf(root, p, 'scripts, .claude');
    write(root, platformReviewDoc('feature/x'), REVIEW_OK);
    write(root, 'scripts/gate.mjs', '// v3\n');
    assert.equal(platformReviewProblems(root, 'feature/x').length, 4);
  });
  test('基盤ファイルの作成者自身のレビューは無効', () => {
    const root = platformRepo();
    recordActivity({ root, state: deriveState(root), input: { agent_id: 'writer', agent_type: 'main', tool_name: 'Edit' }, rel: 'scripts/gate.mjs', branch: 'feature/x' });
    reviewPf(root, 'ガードの抜け穴', 'scripts, .claude', undefined, 'writer');
    for (const p of ALL.slice(1)) reviewPf(root, p, 'scripts, .claude');
    write(root, platformReviewDoc('feature/x'), REVIEW_OK);
    assert.match(platformReviewProblems(root, 'feature/x')[0], /作成者/);
  });
  test('gitignore されたファイルはハッシュに含めない（ローカルと CI の一致）', () => {
    const root = platformRepo();
    write(root, '.gitignore', 'scripts/local.tmp\n');
    for (const p of ALL) reviewPf(root, p, 'scripts, .claude');
    write(root, platformReviewDoc('feature/x'), REVIEW_OK);
    write(root, 'scripts/local.tmp', 'ローカルだけのファイル');
    assert.deepEqual(platformReviewProblems(root, 'feature/x'), []);
  });
});
