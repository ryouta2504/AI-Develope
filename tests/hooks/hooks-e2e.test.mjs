// フックとゲートスクリプトを実際のプロセスとして起動する結合テスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, toPhase, write, CYCLE, REVIEW_OK } from './helpers.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = (name, input) => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [path.join(REPO, '.claude', 'hooks', name)], { input: JSON.stringify(input), encoding: 'utf8', env });
};
const script = (root, name, args = []) => spawnSync(process.execPath, [path.join(REPO, 'scripts', name), ...args], { cwd: root, encoding: 'utf8' });
const D = `docs/cycles/${CYCLE}`;

describe('guard-write フック', () => {
  const root = makeProject();
  toPhase(root, 'requirements');
  test('保護ファイルへの Write は exit 2 で止まり、理由が返る', () => {
    const r = hook('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: path.join(root, '.ai-dev', 'current.json'), content: '{}' }, cwd: root });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\[GATE\]/);
  });
  test('担当エージェントの成果物への Write は通る', () => {
    const r = hook('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: path.join(root, D, '01_requirements.md'), content: '# x' }, cwd: root, agent_type: 'requirements' });
    assert.equal(r.status, 0, r.stderr);
  });
  test('Edit で .skip を追加しようとすると止まる', () => {
    const root2 = makeProject();
    toPhase(root2, 'test_design');
    const f = write(root2, 'src/a.test.ts', "it('[TC-001] a', () => {})\n");
    const r = hook('guard-write.mjs', { tool_name: 'Edit', tool_input: { file_path: f, old_string: "it('", new_string: "it.skip('" }, cwd: root2, agent_type: 'test-designer' });
    assert.equal(r.status, 2);
  });
  test('プロジェクト外でも、一時ディレクトリは許可される', () => {
    const r = hook('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: path.join(path.dirname(root), 'outside.txt'), content: '' }, cwd: root });
    assert.equal(r.status, 0);
  });
});

describe('guard-bash フック', () => {
  const root = makeProject();
  toPhase(root, 'requirements');
  test('承認コマンドは止まる', () => {
    const r = hook('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'npm run approve -- G1' }, cwd: root });
    assert.equal(r.status, 2);
  });
  test('PowerShell ツールでも同じ判定', () => {
    const r = hook('guard-bash.mjs', { tool_name: 'PowerShell', tool_input: { command: 'Set-Content -Path .ai-dev/current.json -Value x' }, cwd: root });
    assert.equal(r.status, 2);
  });
  test('通常のコマンドは通る', () => {
    const r = hook('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'npm run status' }, cwd: root });
    assert.equal(r.status, 0, r.stderr);
  });
});

test('session-context フックは状態を数行で返す', () => {
  const root = makeProject();
  toPhase(root, 'design');
  const r = hook('session-context.mjs', { hook_event_name: 'SessionStart', cwd: root });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[AI-DEV\] C-001-test phase=design/);
  assert.ok(r.stdout.trim().split('\n').length <= 4);
});

describe('stop-gate フック', () => {
  test('人間の承認待ちなら停止を許可し、メッセージを出す', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    write(root, `${D}/reviews/RV-01_requirements.md`, REVIEW_OK);
    script(root, 'gate.mjs', ['REQ_REVIEW']);
    const r = hook('stop-gate.mjs', { hook_event_name: 'Stop', cwd: root, stop_hook_active: false });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /承認待ち/);
  });
  test('implementer の終了時にチェックが失敗したら終了をブロックする（自分で直させる）', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    write(root, '.ai-dev/config.json', JSON.stringify({ commands: { test: 'node -e "process.exit(1)"', lint: 'node -e ""', typecheck: 'node -e ""' } }));
    write(root, 'src/features/add/AddForm.tsx', 'export const AddForm = () => null;\n');
    const r = hook('stop-gate.mjs', { hook_event_name: 'SubagentStop', agent_type: 'implementer', cwd: root, stop_hook_active: false });
    assert.equal(JSON.parse(r.stdout).decision, 'block');
  });
  test('連続ブロックが上限に達したら止めない（無限ループ防止）', () => {
    const root = makeProject();
    toPhase(root, 'implementation');
    write(root, '.ai-dev/config.json', JSON.stringify({ maxStopBlocks: 1, commands: { test: 'node -e "process.exit(1)"', lint: 'node -e ""', typecheck: 'node -e ""' } }));
    write(root, 'src/features/add/AddForm.tsx', 'x\n');
    hook('stop-gate.mjs', { hook_event_name: 'SubagentStop', agent_type: 'implementer', cwd: root, stop_hook_active: false });
    const r = hook('stop-gate.mjs', { hook_event_name: 'SubagentStop', agent_type: 'implementer', cwd: root, stop_hook_active: true });
    assert.notEqual(JSON.parse(r.stdout).decision, 'block');
  });
});

describe('ゲートスクリプト', () => {
  test('REQ_REVIEW: レビュー記録が良好なら合格し、G1 待ちになる', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    write(root, `${D}/reviews/RV-01_requirements.md`, REVIEW_OK);
    const r = script(root, 'gate.mjs', ['REQ_REVIEW']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(deriveState(root).blockingStep.id, 'G1');
  });
  test('REQ_REVIEW: Critical が未解決なら不合格', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    write(root, `${D}/reviews/RV-01_requirements.md`, REVIEW_OK.replace('Minor', 'Critical'));
    const r = script(root, 'gate.mjs', ['REQ_REVIEW']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Critical/);
  });
  test('RED: テストが失敗すれば合格（テストをロック）', () => {
    const root = makeProject();
    toPhase(root, 'test_design');
    write(root, `${D}/03_test_plan.md`, '| TC | 対応 |\n|---|---|\n| TC-001 | AC-001-1 |\n');
    write(root, `${D}/reviews/RV-03_tests.md`, REVIEW_OK);
    write(root, 'src/features/add/AddForm.test.tsx', "it('[TC-001][AC-001-1] 追加', () => {})\n");
    const r = script(root, 'gate.mjs', ['RED']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(deriveState(root).phase, 'implementation');
  });
  test('RED: テストが成功してしまったら不合格', () => {
    const root = makeProject();
    toPhase(root, 'test_design');
    write(root, '.ai-dev/config.json', JSON.stringify({ requireReviewEvidence: false, commands: { test: 'node -e ""' } }));
    write(root, `${D}/03_test_plan.md`, '| TC | 対応 |\n|---|---|\n| TC-001 | AC-001-1 |\n');
    write(root, `${D}/reviews/RV-03_tests.md`, REVIEW_OK);
    write(root, 'src/features/add/AddForm.test.tsx', "it('[TC-001][AC-001-1] 追加', () => {})\n");
    const r = script(root, 'gate.mjs', ['RED']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /RED/);
  });
  test('フェーズ違いのゲートは実行できない', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    assert.equal(script(root, 'gate.mjs', ['GREEN']).status, 1);
  });
  test('承認スクリプトは対話端末がないと動かない', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    const r = script(root, 'approve.mjs', ['G1']);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /人間/);
  });
});
