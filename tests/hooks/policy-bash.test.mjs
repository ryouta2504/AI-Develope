// コマンドガード（checkBash）のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkBash, splitSegments } from '../../scripts/lib/policy.mjs';
import { makeProject, toPhase } from './helpers.mjs';

const run = (root, command, { branch = 'cycle/C-001-test', agentType } = {}) => checkBash({ root, command, cwd: root, branch, agentType });
const ok = (r, msg) => assert.equal(r.allow, true, `${msg}: 許可されるべき（理由: ${r.reason}）`);
const ng = (r, msg) => assert.equal(r.allow, false, `${msg}: ブロックされるべき`);

describe('人間専用の操作', () => {
  const root = makeProject();
  toPhase(root, 'requirements');
  for (const c of ['npm run approve -- G1', 'npm run reject -- G1 "x"', 'node scripts/approve.mjs G1', 'npm run maintenance -- on', 'npm run reopen -- RED x', 'cd x && npm run approve -- G2']) {
    test(`ブロック: ${c}`, () => ng(run(root, c), c));
  }
  test('ゲート・状態確認は実行できる', () => {
    ok(run(root, 'npm run gate -- REQ_REVIEW'), 'gate');
    ok(run(root, 'npm run status'), 'status');
    ok(run(root, 'node scripts/trace.mjs --check'), 'trace');
  });
});

describe('状態ファイル・基盤ファイルへの書き込み', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const blocked = [
    'echo x > .ai-dev/current.json',
    'echo x >> .ai-dev/approvals/G0.json',
    'cp /tmp/x .ai-dev/approvals/G1.json',
    "node -e \"require('fs').writeFileSync('.ai-dev/approvals/G1.json','{}')\"",
    'Set-Content -Path .claude/settings.json -Value x',
    "sed -i 's/a/b/' scripts/gate.mjs",
    'rm -rf .claude',
    'rm -rf src',
    'rm -rf src/features',
    'rm -rf *',
    'mv scripts scripts.bak',
    'tee CLAUDE.md < x',
    'git checkout -- src/features/add/AddForm.test.tsx',
    'patch -p1 < x.diff',
    'git apply x.diff',
  ];
  for (const c of blocked) test(`ブロック: ${c}`, () => ng(run(root, c, { agentType: 'implementer' }), c));
  const allowed = [
    'cat .ai-dev/current.json',
    'ls -la src',
    'npm install react',
    'npx vitest run src/features/add',
    'rm -rf node_modules',
    'ls > /dev/null 2>&1',
    'echo hi 2>&1 | head',
    'git status',
    'git diff --stat',
  ];
  for (const c of allowed) test(`許可: ${c}`, () => ok(run(root, c, { agentType: 'implementer' }), c));
  test('npm pkg set scripts はブロック', () => ng(run(root, 'npm pkg set scripts.test="echo ok"'), 'pkg set'));
});

describe('フェーズ外のパスへのコマンド書き込み', () => {
  const root = makeProject();
  toPhase(root, 'design');
  test('design フェーズで src へリダイレクトは不可', () => ng(run(root, 'echo x > src/App.tsx', { agentType: 'implementer' }), 'src'));
  test('PM がコマンドで成果物を書くのは不可', () => ng(run(root, 'echo x > docs/cycles/C-001-test/02_design.md'), 'PM'));
});

describe('git / gh', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const blocked = [
    ['git push origin main', 'cycle/C-001-test'],
    ['git push', 'main'],
    ['git push --force', 'cycle/C-001-test'],
    ['git push -f origin cycle/C-001-test', 'cycle/C-001-test'],
    ['git push origin +cycle/C-001-test', 'cycle/C-001-test'],
    ['git push origin HEAD:main', 'cycle/C-001-test'],
    ['git push origin --delete cycle/C-001-test', 'cycle/C-001-test'],
    ['git commit -m "x"', 'main'],
    ['git commit --amend', 'cycle/C-001-test'],
    ['git commit --no-verify -m x', 'cycle/C-001-test'],
    ['git commit -n -m x', 'cycle/C-001-test'],
    ['git merge cycle/C-001-test', 'main'],
    ['git rebase main', 'cycle/C-001-test'],
    ['git reset --hard HEAD~1', 'cycle/C-001-test'],
    ['git branch -D wp/C-001/WP-01', 'cycle/C-001-test'],
    ['git config core.hooksPath /dev/null', 'cycle/C-001-test'],
    ['git -c core.hooksPath=/dev/null commit -m x', 'cycle/C-001-test'],
    ['git clean -fd', 'cycle/C-001-test'],
    ['git tag v1', 'cycle/C-001-test'],
    ['gh pr merge 12 --merge', 'cycle/C-001-test'],
    ['gh pr review 12 --approve', 'cycle/C-001-test'],
    ['gh api -X PUT repos/o/r/pulls/1/merge', 'cycle/C-001-test'],
    ['gh repo delete o/r', 'cycle/C-001-test'],
  ];
  for (const [c, branch] of blocked) test(`ブロック: ${c}（${branch}）`, () => ng(run(root, c, { branch }), c));
  const allowed = [
    ['git push -u origin cycle/C-001-test', 'cycle/C-001-test'],
    ['git push', 'cycle/C-001-test'],
    ['git push origin wp/C-001/WP-01', 'wp/C-001/WP-01'],
    ['git push -u origin plan/2026-11', 'plan/2026-11'],
    ['git commit -m "feat(C-001): a -> b > c"', 'cycle/C-001-test'],
    ['git add src && git commit -m "x"', 'cycle/C-001-test'],
    ['git log --oneline -5', 'main'],
    ['git switch -c cycle/C-002-x', 'main'],
    ['gh pr create --base main --title x --body y', 'cycle/C-001-test'],
    ['gh pr view 12', 'cycle/C-001-test'],
    ['gh auth status', 'cycle/C-001-test'],
  ];
  for (const [c, branch] of allowed) test(`許可: ${c}（${branch}）`, () => ok(run(root, c, { branch }), c));
});

test('splitSegments: 引用符内の区切り文字は分割しない', () => {
  assert.deepEqual(splitSegments('echo "a && b" && ls; pwd | cat'), ['echo "a && b"', 'ls', 'pwd', 'cat']);
});

describe('抜け穴の修正（RV-PF-002 / 004 / 005）', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const bash = (command, extra = {}) => run(root, command, { agentType: 'implementer', ...extra });
  test('node -e でゲートの内部（scripts/lib・.ai-dev）を使う実行は止まる', () => {
    ng(bash('node -e "import(\'./scripts/lib/util.mjs\').then(m=>m.writeJSON(\'.ai-dev/maintenance.json\',{}))"'));
    ng(bash('node -p "require(\'fs\').readFileSync(\'.ai-dev/current.json\')"'));
  });
  test('node -r / --import による事前読み込みは止まる', () => {
    ng(bash('node -r ./x.cjs src/a.js'));
    ng(bash('node --import ./x.mjs src/a.js'));
  });
  test('プロジェクト外のスクリプトは実行できない', () => {
    ng(bash('node /tmp/evil.mjs'));
    ng(bash('python ../outside/evil.py'));
  });
  test('git の作業ツリー書き換え系は止まる', () => {
    for (const c of ['git checkout HEAD~1 scripts/lib/policy.mjs', 'git checkout-index -a -f', 'git read-tree -u HEAD', 'git cherry-pick abc', 'git stash pop', 'git clone x y']) ng(bash(c), c);
  });
  test('通常の git checkout（ブランチ切り替え・作成）は止まらない', () => {
    ok(bash('git checkout cycle/C-001-test'));
    ok(bash('git checkout -b wp/C-001/WP-01 HEAD'));
  });
  test('gh pr create は cycle/* ・ plan/* ・ feature/* からだけ', () => {
    ng(bash('gh pr create --base main --head wp/C-001/WP-01'));
    ng(bash('gh pr create --base main', { branch: 'wp/C-001/WP-01' }));
    ok(bash('gh pr create --base main', { branch: 'cycle/C-001-test' }));
  });
});
