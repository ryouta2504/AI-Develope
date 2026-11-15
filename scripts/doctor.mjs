#!/usr/bin/env node
// 環境チェック: npm run doctor
// テンプレートを使い始めるときや、うまく動かないときに実行する。問題があれば直し方を 1 行で表示する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRoot, git, findGh, canonicalPath, readText } from './lib/util.mjs';

const root = findRoot(process.cwd());
const results = [];
const check = (level, name, ok, fix) => results.push({ level: ok ? 'ok' : level, name, fix });
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

if (!root) {
  console.error('❌ テンプレートのフォルダ（package.json と .ai-dev があるフォルダ）で実行してください。');
  console.error(`   いまの場所: ${process.cwd()}`);
  process.exit(1);
}

// 1. ツール
const nodeMajor = Number(process.versions.node.split('.')[0]);
check('error', `Node.js ${process.versions.node}（22 以上が必要）`, nodeMajor >= 22, 'https://nodejs.org/ から Node.js 22 以上を入れてください');
check('error', 'Git', !!run('git', ['--version']), 'https://git-scm.com/ から Git を入れてください');
const gh = findGh();
check('warn', 'GitHub CLI（gh）', !!gh, 'winget install GitHub.cli を実行し、VSCode を再起動してください');
if (gh) check('warn', 'GitHub CLI のログイン', !!run(gh, ['auth', 'status']), 'gh auth login を実行してください（PR の作成に必要）');
check('warn', 'Claude Code', !!run('claude', ['--version']), 'Claude Code（VSCode 拡張または CLI）を入れてください');

// 2. 置き場所
const claudeDir = canonicalPath(path.join(os.homedir(), '.claude'));
const rel = path.relative(claudeDir, canonicalPath(root));
const insideClaude = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
check(
  'warn',
  `置き場所（${root}）`,
  !insideClaude,
  `~/.claude の中は Claude Code の設定フォルダとして扱われ、編集のたびに確認が出たり拒否されたりします。${path.join(os.homedir(), 'dev')} などに移してください`,
);

// 3. git の設定
check('error', 'git のユーザー名', !!git(root, ['config', 'user.name']), 'git config --global user.name "あなたの名前" を実行してください');
check('error', 'git フック（コミット規約の検証）', git(root, ['config', 'core.hooksPath']) === '.githooks', 'npm run setup を実行してください');
const origin = git(root, ['remote', 'get-url', 'origin']);
check('warn', 'リモート（origin）', !!origin, 'GitHub にリポジトリを作り、git remote add origin <URL> を実行してください');

// 4. CODEOWNERS（テンプレートから作ったプロジェクトでは担当者の書き換えが必要）
const owners = readText(path.join(root, '.github', 'CODEOWNERS'), '');
const repoOwner = origin?.match(/github\.com[:/]([^/]+)\//)?.[1];
const codeOwners = [...new Set([...owners.matchAll(/@([\w-]+)/g)].map((m) => m[1]))];
if (repoOwner && codeOwners.length) {
  check(
    'warn',
    `CODEOWNERS の担当者（${codeOwners.map((o) => '@' + o).join(', ')}）`,
    codeOwners.some((o) => o.toLowerCase() === repoOwner.toLowerCase()),
    `.github/CODEOWNERS の担当者を、このリポジトリのレビュー担当者（例: @${repoOwner}）に書き換えてください`,
  );
}

// 5. テンプレートのファイル
for (const f of ['.claude/settings.json', '.claude/hooks/guard-write.mjs', '.claude/hooks/guard-bash.mjs', 'scripts/lib/policy.mjs', '.ai-dev/config.json']) {
  check('error', `必要なファイル: ${f}`, fs.existsSync(path.join(root, f)), 'テンプレートからファイルが欠けています。テンプレートのリポジトリから取り直してください');
}

// 表示
const icon = { ok: '✅', warn: '⚠', error: '❌' };
console.log(`環境チェック（${root}）\n`);
for (const r of results) {
  console.log(`${icon[r.level]} ${r.name}`);
  if (r.level !== 'ok') console.log(`   → ${r.fix}`);
}
const errors = results.filter((r) => r.level === 'error').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(`\n${errors ? `❌ 要対応 ${errors} 件` : '✅ 必須の項目はすべて OK'}${warns ? ` / ⚠ 推奨 ${warns} 件` : ''}`);
console.log('次: VSCode でこのフォルダを開き、Claude Code で /pm と入力してください（詳しくは docs/GETTING_STARTED.md）。');
process.exit(errors ? 1 : 0);
