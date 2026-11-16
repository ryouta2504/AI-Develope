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
    fs.rmSync(path.join(root, '.ai-dev/.cache/tripwire'), { recursive: true, force: true }); // find -delete など（基準を全部消す）
    write(root, 'scripts/a.mjs', 'TAMPERED');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  const git = (root, ...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  /** origin（bare）を作り、main を push する（tripwire はローカルの main ではなく origin/main を信用する） */
  const withOrigin = (root) => {
    const remote = fs.mkdtempSync(path.join(path.dirname(root), 'aidev-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', 'origin', 'main');
    git(root, 'fetch', '-q', 'origin');
  };
  test('統合ブランチ（origin/main）への切り替えで HEAD が動き、そこにある内容は正当として受け入れる', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'README.md', 'v1');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'v1');
    git(root, 'switch', '-q', '-c', 'cycle/C-002-x');
    git(root, 'switch', '-q', 'main');
    write(root, 'README.md', 'v2'); // main だけが先に進む（別の PR のマージ）
    git(root, 'commit', '-q', '-am', 'v2');
    withOrigin(root);
    git(root, 'switch', '-q', 'cycle/C-002-x');
    run(root, 'PreToolUse');
    git(root, 'switch', '-q', 'main'); // npm run cycle:new などの切り替え
    assert.equal(run(root, 'PostToolUse').status, 0);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'v2');
    // その後の改ざんは戻る
    write(root, 'README.md', 'v3');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'v2');
  });
  test('ローカルの main を動かして内容を「既知」にしても受け入れない（origin/main だけを信用する）', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'scripts/a.mjs', 'ORIGINAL');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'switch', '-q', '-c', 'cycle/C-001-x');
    run(root, 'PreToolUse');
    write(root, 'scripts/a.mjs', 'TAMPERED');
    git(root, 'commit', '-q', '-am', 'sneaky');
    git(root, 'branch', '-f', 'main', 'HEAD'); // ローカルの main に載せる
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  test('別のファイルの内容への置き換え（同じ blob でもパスが違う）は受け入れない', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'scripts/a.mjs', 'AAA');
    write(root, 'scripts/b.mjs', 'BBB');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    withOrigin(root);
    git(root, 'switch', '-q', '-c', 'cycle/C-001-x');
    run(root, 'PreToolUse');
    write(root, 'scripts/a.mjs', 'BBB'); // b と同じ内容（origin/main に blob はあるが、a のパスではない）
    git(root, 'commit', '-q', '-am', 'swap');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'AAA');
  });
  test('人間の承認・差し戻しの commit（ツール実行の合間）は、次の Pre で消されず基準になる', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'README.md', 'x');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'switch', '-q', '-c', 'cycle/C-001-x');
    run(root, 'PreToolUse');
    run(root, 'PostToolUse');
    // 人間がターミナルで npm run approve G1 を実行（承認記録を書いて commit）
    write(root, '.ai-dev/cycles/C-001-x/approvals/G1.json', '{"status":"approved"}');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'approve G1');
    assert.equal(run(root, 'PreToolUse').status, 0);
    assert.equal(fs.readFileSync(path.join(root, '.ai-dev/cycles/C-001-x/approvals/G1.json'), 'utf8'), '{"status":"approved"}');
    run(root, 'PostToolUse');
    // 人間が reject G1 を実行（記録を書き換えて commit）。承認済みへ戻されない
    write(root, '.ai-dev/cycles/C-001-x/approvals/G1.json', '{"status":"rejected"}');
    git(root, 'commit', '-q', '-am', 'reject G1');
    assert.equal(run(root, 'PreToolUse').status, 0);
    assert.equal(fs.readFileSync(path.join(root, '.ai-dev/cycles/C-001-x/approvals/G1.json'), 'utf8'), '{"status":"rejected"}');
    assert.equal(run(root, 'PostToolUse').status, 0);
  });
  test('ツールの中で書き換えて commit しただけの変更は受け入れない', () => {
    const root = makeProject({ branch: 'main' });
    write(root, 'scripts/a.mjs', 'ORIGINAL');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'switch', '-q', '-c', 'cycle/C-001-x');
    run(root, 'PreToolUse');
    write(root, 'scripts/a.mjs', 'TAMPERED'); // 列挙外の手段で書き換え
    git(root, 'commit', '-q', '-am', 'sneaky');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  test('maintenance -- off（maintenance.json の削除）が効き、基準から復元されない', () => {
    const root = makeProject();
    write(root, 'README.md', 'a');
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600e3).toISOString() }));
    run(root, 'PreToolUse');
    run(root, 'PostToolUse');
    fs.rmSync(path.join(root, '.ai-dev/maintenance.json')); // 人間が off を実行
    assert.equal(run(root, 'PreToolUse').status, 0);
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev/maintenance.json')), 'off のあとに復元されない');
    // off の後は、テンプレートの変更が戻る
    write(root, 'README.md', 'tampered');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'a');
  });
  test('実行中に偽造された maintenance.json は消す。その中で書いたテンプレートも戻す', () => {
    const root = makeProject();
    write(root, 'README.md', 'a');
    run(root, 'PreToolUse');
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600e3).toISOString() }));
    write(root, 'README.md', 'tampered');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.ok(!fs.existsSync(path.join(root, '.ai-dev/maintenance.json')));
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'a');
  });
  test('基準の一部だけ消された・書き換えられたら、HEAD を基準に作り直して戻す（素通りしない）', () => {
    const root = makeProject();
    write(root, 'scripts/a.mjs', 'ORIGINAL');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    run(root, 'PreToolUse');
    const cache = path.join(root, '.ai-dev/.cache/tripwire');
    const gen = fs.readFileSync(path.join(cache, 'current'), 'utf8').trim();
    fs.rmSync(path.join(cache, gen, 'files', 'scripts/a.mjs')); // index.json だけ残して中身を消す
    write(root, 'scripts/a.mjs', 'TAMPERED');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
    // 基準の中身の書き換え（改ざんした内容を書き戻させる）も検出する
    run(root, 'PreToolUse');
    const gen2 = fs.readFileSync(path.join(cache, 'current'), 'utf8').trim();
    fs.writeFileSync(path.join(cache, gen2, 'files', 'scripts/a.mjs'), 'EVIL');
    write(root, 'scripts/a.mjs', 'TAMPERED');
    assert.equal(run(root, 'PostToolUse').status, 2);
    assert.equal(fs.readFileSync(path.join(root, 'scripts/a.mjs'), 'utf8'), 'ORIGINAL');
  });
  test('旧形式の基準（base/）が新しければそれを使う（tripwire 自身の入れ替え）', () => {
    const root = makeProject();
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600e3).toISOString() }));
    write(root, 'README.md', 'a');
    run(root, 'PreToolUse');
    run(root, 'PostToolUse'); // 新形式の基準ができる（maint: true）
    // 古い版が後から旧形式の基準を保存した（メンテナンス中として信用）状況を作る
    const cache = path.join(root, '.ai-dev/.cache/tripwire');
    const gen = fs.readFileSync(path.join(cache, 'current'), 'utf8').trim();
    fs.cpSync(path.join(cache, gen), path.join(cache, 'base'), { recursive: true });
    const idxPath = path.join(cache, 'base', 'index.json');
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    idx.maint = true;
    fs.writeFileSync(idxPath, JSON.stringify(idx));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(idxPath, future, future);
    write(root, 'README.md', 'b'); // メンテナンス中の変更
    assert.equal(run(root, 'PostToolUse').status, 0);
    assert.ok(fs.existsSync(path.join(root, '.ai-dev/maintenance.json')));
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'b');
  });
  test('並列のツール呼び出しで、基準の世代が切り替わっても「基準なし」にならない', () => {
    const root = makeProject();
    write(root, 'README.md', 'a');
    run(root, 'PreToolUse');
    const cache = path.join(root, '.ai-dev/.cache/tripwire');
    for (let i = 0; i < 4; i++) {
      run(root, 'PostToolUse');
      assert.ok(fs.existsSync(path.join(cache, 'current')), 'current は常にある');
    }
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
