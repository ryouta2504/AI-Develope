#!/usr/bin/env node
// 初期設定: npm run setup
// git フック（コミット規約の検証）を有効にし、状態ファイルの初期値を作る。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRoot, git, writeJSON } from './lib/util.mjs';

const root = findRoot(process.cwd()) || process.cwd();
git(root, ['config', 'core.hooksPath', '.githooks']);
console.log('✔ git フックを有効にしました（.githooks/）');

const current = path.join(root, '.ai-dev', 'current.json');
if (!fs.existsSync(current)) writeJSON(current, { cycle: null });

let gh = false;
for (const c of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) {
  try {
    execFileSync(c, ['auth', 'status'], { stdio: 'ignore' });
    gh = true;
    break;
  } catch {
    /* 次へ */
  }
}
console.log(gh ? '✔ GitHub CLI: ログイン済み' : '⚠ GitHub CLI: 未ログイン（gh auth login を実行してください）');
console.log(`✔ git ユーザー: ${git(root, ['config', 'user.name']) || '未設定'}`);
console.log('\n次: Claude Code で /pm を実行すると、PM が状態を確認して作業を始めます。');
