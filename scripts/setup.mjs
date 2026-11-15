#!/usr/bin/env node
// 初期設定: npm run setup
// git フック（コミット規約の検証）を有効にし、状態ファイルの初期値を作る。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRoot, git, writeJSON, findGh } from './lib/util.mjs';

const root = findRoot(process.cwd()) || process.cwd();
git(root, ['config', 'core.hooksPath', '.githooks']);
console.log('✔ git フックを有効にしました（.githooks/）');

const current = path.join(root, '.ai-dev', 'current.json');
if (!fs.existsSync(current)) writeJSON(current, { cycle: null });

let gh = false;
const ghBin = findGh();
if (ghBin) {
  try {
    execFileSync(ghBin, ['auth', 'status'], { stdio: 'ignore' });
    gh = true;
  } catch {
    /* 未ログイン */
  }
}
console.log(gh ? '✔ GitHub CLI: ログイン済み' : '⚠ GitHub CLI: 未ログイン（gh auth login を実行してください）');
console.log(`✔ git ユーザー: ${git(root, ['config', 'user.name']) || '未設定'}`);
console.log('\n次: npm run doctor で環境を確認してから、VSCode でこのフォルダを開き、Claude Code で /pm を実行してください。');
