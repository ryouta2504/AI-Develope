// RV-PF 3 回目の Critical（ガードの抜け穴 3〜6）への対応のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkBash, switchedBranch } from '../../scripts/lib/policy.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { makeProject, write, CYCLE } from './helpers.mjs';

const sh = (root, ...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

/** 承認記録のあるリポジトリ: base（承認なし）→ 承認 → 差し戻し の順にコミットする */
function repoWithReject() {
  const root = makeProject({ branch: 'main' });
  write(root, 'README.md', 'x');
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'base');
  const before = sh(root, 'rev-parse', 'HEAD').trim();
  sh(root, 'switch', '-q', '-c', `cycle/${CYCLE}`);
  write(root, `.ai-dev/cycles/${CYCLE}/approvals/G2.json`, '{"status":"approved"}');
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'approve G2');
  const approved = sh(root, 'rev-parse', 'HEAD').trim();
  write(root, `.ai-dev/cycles/${CYCLE}/approvals/G2.json`, '{"status":"rejected"}');
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'reject G2');
  return { root, before, approved };
}
const bash = (root, command, extra = {}) => checkBash({ root, command, state: { ...deriveState(root), cycle: CYCLE }, branch: `cycle/${CYCLE}`, ...extra });

describe('Critical 3: git で人間の差し戻しを取り消せない', () => {
  test('git revert / pull は禁止', () => {
    const { root } = repoWithReject();
    assert.equal(bash(root, 'git revert -n HEAD').allow, false);
    assert.equal(bash(root, 'git pull').allow, false);
  });
  test('差し戻し前のコミットへの switch / checkout（新規ブランチ作成を含む）は禁止', () => {
    const { root, approved } = repoWithReject();
    assert.equal(bash(root, `git switch -c x ${approved}`).allow, false);
    assert.equal(bash(root, `git switch --detach ${approved}`).allow, false);
    assert.equal(bash(root, `git checkout ${approved}`).allow, false);
  });
  test('記録が変わらない普通の切り替え・作成は止まらない', () => {
    const { root } = repoWithReject();
    sh(root, 'branch', 'plan/next');
    assert.equal(bash(root, 'git switch plan/next').allow, true);
    assert.equal(bash(root, 'git switch -c cycle/C-002-x').allow, true);
  });
  test('ゲート記録を変える merge は禁止', () => {
    const { root, approved } = repoWithReject();
    sh(root, 'switch', '-q', 'main');
    sh(root, 'switch', '-q', '-c', 'plan/z');
    assert.equal(bash(root, `git merge ${approved}`, { branch: 'plan/z' }).allow, false);
  });
});

describe('Critical 4: 保護ブランチの判定が同じコマンドの中の切り替えに追従する', () => {
  test('switchedBranch は切り替え先を返す', () => {
    assert.equal(switchedBranch(['switch', 'main']), 'main');
    assert.equal(switchedBranch(['checkout', '-b', 'x', 'main']), 'x');
    assert.equal(switchedBranch(['switch', '-c', 'y']), 'y');
    assert.equal(switchedBranch(['checkout', '--', 'a.txt']), null);
    assert.equal(switchedBranch(['status']), null);
  });
  test('git switch main && git merge … は止まる', () => {
    const { root } = repoWithReject();
    sh(root, 'branch', 'plan/q');
    const r = bash(root, 'git switch main && git merge plan/q');
    assert.equal(r.allow, false, 'main に切り替えた後のマージは保護ブランチへのマージ');
  });
  test('git switch main && git commit は止まる', () => {
    const { root } = repoWithReject();
    assert.equal(bash(root, 'git switch main && git commit -m x').allow, false);
  });
  test('GIT_CONFIG_* / GIT_DIR などの環境変数は禁止', () => {
    const { root } = repoWithReject();
    assert.equal(bash(root, 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=HEAD:refs/heads/main git push').allow, false);
    assert.equal(bash(root, 'export GIT_DIR=/tmp/x; git status').allow, false);
    assert.equal(bash(root, '$env:GIT_CONFIG_COUNT = 1; git push').allow, false);
  });
});

describe('Critical 5: 人間専用スクリプトの端末判定を迂回できない', () => {
  const root = makeProject();
  const ng = (c) => assert.equal(bash(root, c).allow, false, c);
  test('env -u CLAUDECODE / sudo -u など、ラッパーのオプションの後ろも見る', () => {
    ng('env -u CLAUDECODE node scripts/approve.mjs G1');
    ng('env -i node scripts/maintenance.mjs on');
    ng('timeout 10 node scripts/approve.mjs G1');
    ng('nohup node scripts/reject.mjs G2 x');
  });
  test('scripts の中に cd してから実行しても止まる', () => {
    ng('cd scripts && node approve.mjs G1');
  });
  test('疑似端末・別コンソールのラッパーは禁止', () => {
    ng('script -qc "node scripts/approve.mjs G1" /dev/null');
    ng('expect -c "spawn node scripts/approve.mjs"');
    ng('winpty node scripts/approve.mjs G1');
    ng('Start-Process node -ArgumentList scripts/approve.mjs');
  });
  test('python の pty 経由は禁止', () => {
    ng(`CLAUDECODE= python3 -c "import pty;pty.spawn(['node','x'])"`);
  });
  test('通常のコマンドは止まらない', () => {
    assert.equal(bash(root, 'npm run status').allow, true);
    assert.equal(bash(root, 'timeout 10 node -v').allow, true);
    assert.equal(bash(root, 'env FOO=1 node -v').allow, true);
  });
});

describe('Critical 6: gh api は読み取り（GET）だけ', () => {
  const root = makeProject();
  const ng = (c) => assert.equal(bash(root, c).allow, false, c);
  test('merges・-f・-F・--input・graphql・POST は禁止', () => {
    ng('gh api repos/O/R/merges -f base=main -f head=cycle/x');
    ng('gh api repos/O/R/pulls -f title=x');
    ng('gh api repos/O/R/pulls -F body=@file');
    ng('gh api repos/O/R/pulls --input body.json');
    ng('gh api graphql -f query=@q.graphql');
    ng('gh api -X POST repos/O/R/issues');
    ng('curl -X POST https://api.github.com/repos/O/R/merges');
  });
  test('読み取りは通る', () => {
    assert.equal(bash(root, 'gh api repos/O/R/pulls').allow, true);
    assert.equal(bash(root, 'gh api -X GET repos/O/R/pulls').allow, true);
  });
});

describe('原文の保存: 報告が hand-back で返っても空にならない', () => {
  test('readTranscript は hand-back の本文と最後のテキストを取り出す', async () => {
    const { readTranscript } = await import('../../scripts/lib/review-evidence.mjs');
    const root = makeProject();
    const lines = [
      { type: 'user', message: { role: 'user', content: 'レビュー番号: RV-PF' } },
      { type: 'assistant', message: { model: 'm', content: [{ type: 'text', text: '途中の考え' }] } },
      { type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: '| Major | 指摘A |' } }] } },
      { type: 'assistant', message: { model: 'm', content: [{ type: 'text', text: '完了' }] } },
    ];
    const f = write(root, 'transcript.jsonl', lines.map((l) => JSON.stringify(l)).join('\n'));
    const tr = readTranscript(f);
    assert.equal(tr.handback, '| Major | 指摘A |');
    assert.equal(tr.report, '完了');
  });
  test('recordReviewRun は last_assistant_message が空でも、transcript の報告を原文に残す', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { recordReviewRun } = await import('../../scripts/lib/review-evidence.mjs');
    const root = makeProject({ branch: 'feature/x' });
    const prompt = 'レビュー番号: RV-PF\n観点: 保守性\n対象: scripts\n基準: README.md';
    const lines = [
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: '| Critical | 本物の指摘 |' } }] } },
    ];
    const t = write(root, 'tr.jsonl', lines.map((l) => JSON.stringify(l)).join('\n'));
    recordReviewRun({ root, state: deriveState(root), input: { agent_id: 'agentX', agent_type: 'reviewer', agent_transcript_path: t, last_assistant_message: '' }, branch: 'feature/x' });
    const raw = fs.readFileSync(path.join(root, '.ai-dev', 'platform', 'feature_x', 'reviews', 'raw', 'agentX.md'), 'utf8');
    assert.match(raw, /本物の指摘/);
  });
});

describe('シェル構文の素通り（安く直せる範囲）', () => {
  const root = makeProject();
  const ng = (c) => assert.equal(bash(root, c).allow, false, c);
  const ok = (c) => assert.equal(bash(root, c).allow, true, c);
  test('単独の & で区切られたコマンドも検査する', () => {
    ng('echo ok & echo x > scripts/lib/policy.mjs');
    ng('true & git push origin main');
  });
  test('$(…)・バッククォート・<(…) の中身も検査する', () => {
    ng('echo $(git push origin main)');
    ng('echo `git revert HEAD`');
    ng('cat <(git pull)');
  });
  test('if / then / do / else の後ろのコマンドも検査する', () => {
    ng('if true; then echo x > scripts/lib/policy.mjs; fi');
    ng('for i in 1; do git push origin main; done');
  });
  test('npm run の別の書き方でも人間専用の操作は止まる', () => {
    ng('npm run --silent approve -- G1');
    ng('npm --prefix . run approve G1');
    ng('npm rum maintenance on');
    ng('npx npm run reject G2 x');
  });
  test('curl で GitHub に GET 以外を送る・認証情報の取り出しは禁止', () => {
    ng('curl -X PUT https://api.github.com/repos/O/R/contents/a.txt -d x');
    ng('curl --data x https://api.github.com/repos/O/R/issues');
    ng('Invoke-RestMethod -Method Patch https://api.github.com/repos/O/R/git/refs/heads/x');
    ng('git credential fill');
  });
  test('普通のコマンドは止まらない', () => {
    ok('echo a & echo b');
    ok('echo $(date)');
    ok('if true; then echo x; fi');
    ok('curl https://api.github.com/repos/O/R/pulls');
    ok('npm run test');
  });
});

describe('Critical 2: 上書きリダイレクト（>|）も書き込み先を検査する', () => {
  test('>| で承認記録・scripts への書き込みは禁止', () => {
    const root = makeProject();
    assert.equal(bash(root, `printf '{"status":"approved"}' >| .ai-dev/cycles/${CYCLE}/approvals/G2.json`).allow, false);
    assert.equal(bash(root, 'echo x >| scripts/lib/policy.mjs').allow, false);
  });
});
