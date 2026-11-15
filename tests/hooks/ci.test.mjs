// ci.mjs（最後の防衛線）の結合テスト。サーバー側の検査が fail-closed であることを確かめる
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, toPhase, write, CYCLE } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = (root, headRef) => {
  const env = { ...process.env, GITHUB_HEAD_REF: headRef, GITHUB_BASE_REF: 'main' };
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'ci.mjs')], { cwd: root, encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe('ci.mjs', () => {
  test('cycle/plan/feature 以外のブランチ（wp/* や任意名）は不合格（fail-closed）', () => {
    for (const b of ['wp/C-001/WP-01', 'hotfix/x', 'main']) {
      const root = makeProject({ branch: b.replace(/\//g, '-') });
      toPhase(root, 'ai_review');
      const r = ci(root, b);
      assert.equal(r.status, 1, b);
      assert.match(r.out, /PR を許可していません/, b);
    }
  });
  test('feature/* は、テンプレート以外（src など）の変更を含むと不合格', () => {
    const root = makeProject({ branch: 'main' });
    const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    write(root, 'README.md', 'x');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    const remote = fs.mkdtempSync(path.join(path.dirname(root), 'aidev-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    g('remote', 'add', 'origin', remote);
    g('push', '-q', 'origin', 'main');
    g('fetch', '-q', 'origin');
    g('switch', '-q', '-c', 'feature/x');
    write(root, 'src/app.ts', 'export const x = 1;\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'feat: add');
    const r = ci(root, 'feature/x');
    assert.equal(r.status, 1);
    assert.match(r.out, /❌ feature\/\* の変更範囲/);
    assert.match(r.out, /src\/app\.ts/);
  });
  test('feature/* は、テンプレートと関連文書だけなら、変更範囲の検査は通る', () => {
    const root = makeProject({ branch: 'main' });
    const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    write(root, 'README.md', 'x');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    const remote = fs.mkdtempSync(path.join(path.dirname(root), 'aidev-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    g('remote', 'add', 'origin', remote);
    g('push', '-q', 'origin', 'main');
    g('fetch', '-q', 'origin');
    g('switch', '-q', '-c', 'feature/x');
    write(root, 'scripts/a.mjs', 'x');
    write(root, 'docs/memo/note.md', 'x');
    g('add', '-A');
    g('commit', '-q', '-m', 'chore: tweak');
    const r = ci(root, 'feature/x');
    assert.match(r.out, /✅ feature\/\* の変更範囲/);
  });
  test('cycle/* で G0 が無効でも、G1〜G3 の未承認を見逃さない', () => {
    const root = makeProject();
    toPhase(root, 'final_review');
    write(root, 'docs/plan.md', '# 計画（承認後に変更）\n'); // G0 を無効にする
    const r = ci(root, `cycle/${CYCLE}`);
    assert.equal(r.status, 1);
    assert.match(r.out, /G0 が未承認、または承認後に/);
    assert.match(r.out, /G3（人間）: 記録がありません/);
  });
});
