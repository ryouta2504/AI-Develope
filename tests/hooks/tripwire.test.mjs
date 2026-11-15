// tripwire: 手段を問わず、メンテナンスモードでないテンプレートの変更を元に戻す
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, write } from './helpers.mjs';
import { PLATFORM } from '../../scripts/lib/config.mjs';
import { WATCH_DIRS, WATCH_FILES } from '../../.claude/hooks/tripwire.mjs';

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
    for (const g of PLATFORM) assert.ok(watched.has(g), `${g} が tripwire の監視対象にありません`);
  });
});
