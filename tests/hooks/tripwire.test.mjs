// tripwire: 手段を問わず、メンテナンスモードでないテンプレートの変更を元に戻す
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, write } from './helpers.mjs';
import { PLATFORM } from '../../scripts/lib/config.mjs';
import { WATCH_DIRS, WATCH_FILES, NESTED_NAMES } from '../../.claude/hooks/tripwire.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (root, event) => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [path.join(REPO, '.claude', 'hooks', 'tripwire.mjs')], { input: JSON.stringify({ hook_event_name: event, cwd: root }), encoding: 'utf8', env });
};

describe('tripwire', () => {
  test('メンテナンス外でテンプレートが書き換えられると元に戻して exit 2', () => {
    const root = makeProject();
    write(root, 'scripts/lib/policy.mjs', 'ORIGINAL');
    run(root, 'PreToolUse');
    write(root, 'scripts/lib/policy.mjs', 'TAMPERED'); // Windows の WriteAllText や xcopy などを想定
    write(root, '.claude/settings.json', '{}');
    const r = run(root, 'PostToolUse');
    assert.equal(r.status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/lib/policy.mjs'), 'utf8'), 'ORIGINAL');
    assert.ok(!fs.existsSync(path.join(root, '.claude/settings.json')), '新規ファイルは削除される');
  });
  test('削除されたファイルも戻す', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', 'x');
    run(root, 'PreToolUse');
    fs.rmSync(path.join(root, 'CLAUDE.md'));
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), 'x');
  });
  test('承認記録とメンテナンスの設定の偽造も戻す', () => {
    const root = makeProject();
    run(root, 'PreToolUse');
    write(root, '.ai-dev/approvals/G0.json', '{"status":"approved"}');
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600e3).toISOString() }));
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev/approvals/G0.json')));
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev/maintenance.json')));
  });
  test('変更がなければ何もしない', () => {
    const root = makeProject();
    write(root, 'README.md', 'x');
    run(root, 'PreToolUse');
    assert.equal(run(root, 'PostToolUse').status, 0);
  });
  test('メンテナンス中は変更を許す', () => {
    const root = makeProject();
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600e3).toISOString() }));
    write(root, 'README.md', 'a');
    run(root, 'PreToolUse');
    write(root, 'README.md', 'b');
    assert.equal(run(root, 'PostToolUse').status, 0);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'b');
  });
  test('製品コードの変更は対象外', () => {
    const root = makeProject();
    run(root, 'PreToolUse');
    write(root, 'src/a.ts', 'x');
    assert.equal(run(root, 'PostToolUse').status, 0);
  });
  test('監視範囲が config.mjs の PLATFORM と一致している（自己完結のため一覧を複製している）', () => {
    const watched = new Set([...WATCH_DIRS.map((d) => `${d}/**`), ...WATCH_FILES]);
    for (const g of PLATFORM) {
      if (g.startsWith('**/')) assert.ok(NESTED_NAMES.includes(g.slice(3)), `${g} が tripwire の全階層の監視（NESTED_NAMES）にありません`);
      else assert.ok(watched.has(g), `${g} が tripwire の監視対象にありません`);
    }
  });
  test('入れ子の CLAUDE.md（src/CLAUDE.md など）の書き換えも戻す', () => {
    const root = makeProject();
    write(root, 'src/deep/CLAUDE.md', 'ORIGINAL');
    run(root, 'PreToolUse');
    write(root, 'src/deep/CLAUDE.md', 'TAMPERED');
    write(root, 'src/other/CLAUDE.local.md', 'NEW');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'src/deep/CLAUDE.md'), 'utf8'), 'ORIGINAL');
    assert.ok(!fs.existsSync(path.join(root, 'src/other/CLAUDE.local.md')));
  });
  test('サイクルの承認記録（G1〜G3）の偽造も戻す', () => {
    const root = makeProject();
    write(root, '.ai-dev/cycles/C-001-x/approvals/G1.json', '{"status":"approved"}');
    run(root, 'PreToolUse');
    write(root, '.ai-dev/cycles/C-001-x/approvals/G2.json', '{"status":"approved"}');
    write(root, '.ai-dev/cycles/C-001-x/approvals/G1.json', '{"status":"rejected"}');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev/cycles/C-001-x/approvals/G2.json')));
    assert.equal(fs.readFileSync(path.join(root, '.ai-dev/cycles/C-001-x/approvals/G1.json'), 'utf8'), '{"status":"approved"}');
  });
  test('ゲートの記録（gates/）は監視しない（スクリプトが正当に書く）', () => {
    const root = makeProject();
    run(root, 'PreToolUse');
    write(root, '.ai-dev/cycles/C-001-x/gates/RED.json', '{}');
    assert.equal(run(root, 'PostToolUse').status, 0);
  });
  test('Post が発火しなかった変更・Post の後の変更も、次の Pre で戻る', () => {
    const root = makeProject();
    write(root, 'scripts/a.mjs', 'ORIGINAL');
    run(root, 'PreToolUse');
    run(root, 'PostToolUse');
    write(root, 'scripts/a.mjs', 'TAMPERED'); // Post の後（バックグラウンド実行など）
    assert.equal(run(root, 'PreToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  test('基準を消されても、同じコマンドの改ざんは git の HEAD の内容に戻す', () => {
    const root = makeProject();
    write(root, 'scripts/a.mjs', 'ORIGINAL');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    run(root, 'PreToolUse');
    fs.rmSync(path.join(root, '.ai-dev/.cache/tripwire'), { recursive: true, force: true }); // find -delete など
    write(root, 'scripts/a.mjs', 'TAMPERED');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  test('ブランチの切り替えなど HEAD が動いて、HEAD と一致する変更は正当として受け入れる', () => {
    const root = makeProject();
    write(root, 'README.md', 'v1');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'v1'], { cwd: root });
    run(root, 'PreToolUse');
    execFileSync('git', ['checkout', '-q', '-b', 'other'], { cwd: root });
    write(root, 'README.md', 'v2');
    execFileSync('git', ['commit', '-q', '-am', 'v2'], { cwd: root });
    assert.equal(run(root, 'PostToolUse').status, 0);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'v2');
    // その後の改ざんは戻る
    write(root, 'README.md', 'v3');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'v2');
  });
  test('並列のツール呼び出し（Pre・Post が交互）でも改ざんを見逃さない', () => {
    const root = makeProject();
    write(root, 'README.md', 'ORIGINAL');
    run(root, 'PreToolUse'); // A
    run(root, 'PreToolUse'); // B
    run(root, 'PostToolUse'); // A（変更なし）
    write(root, 'README.md', 'TAMPERED'); // B の実行中
    assert.equal(run(root, 'PostToolUse').status, 2); // B
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'ORIGINAL');
  });
});
