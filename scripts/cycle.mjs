#!/usr/bin/env node
// サイクルの開始: npm run cycle:new -- <短い名前(英小文字・数字・ハイフン)>
// G0（開発計画）承認済みで、前のサイクルが完了（または未開始）のときだけ開始できる。
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, git, writeJSON, nowIso } from './lib/util.mjs';
import { deriveState, appendHistory } from './lib/state.mjs';
import { artifactPaths } from './lib/config.mjs';

const root = findRoot(process.cwd());
const [sub, slugArg] = process.argv.slice(2);

function die(msg) {
  console.error(`⛔ ${msg}`);
  process.exit(1);
}

if (sub !== 'new') die('使い方: npm run cycle:new -- <短い名前>');
const slug = (slugArg || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
if (!slug) die('短い名前を指定してください（例: npm run cycle:new -- todo-basic）');

const state = deriveState(root);
if (state.phase === 'planning') die('G0（開発計画）が未承認です。先に /plan → 人間の承認（npm run approve -- G0）を行ってください。');
if (!['idle', 'done'].includes(state.phase)) die(`サイクル ${state.cycle} が進行中です（phase=${state.phase}）。完了してから次を開始してください。`);

const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
if (dirty) die('コミットされていない変更があります。先にコミットしてください。');

// 次の番号を採番
const used = [];
for (const d of [path.join(root, '.ai-dev', 'cycles'), path.join(root, 'docs', 'cycles')]) {
  if (fs.existsSync(d)) for (const n of fs.readdirSync(d)) used.push(Number(n.match(/^C-(\d+)/)?.[1] || 0));
}
const num = String(Math.max(0, ...used) + 1).padStart(3, '0');
const id = `C-${num}-${slug}`;
const branch = `cycle/${id}`;

// 最新の main から分岐
git(root, ['fetch', 'origin', 'main']);
const base = git(root, ['rev-parse', '--verify', 'origin/main']) ? 'origin/main' : 'main';
if (git(root, ['switch', '-c', branch, base]) === null) die(`ブランチ ${branch} を作成できませんでした`);

// 成果物フォルダとテンプレート
const a = artifactPaths(id);
const tpl = (name) => path.join(root, 'docs', 'templates', name);
const copies = [
  ['01_requirements.md', a.req],
  ['02_design.md', a.design],
  ['03_test_plan.md', a.testPlan],
];
for (const [t, dest] of copies) {
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  if (fs.existsSync(tpl(t))) fs.writeFileSync(path.join(root, dest), fs.readFileSync(tpl(t), 'utf8').replaceAll('{{CYCLE}}', id));
}
fs.mkdirSync(path.join(root, a.dir, 'reviews'), { recursive: true });
fs.mkdirSync(path.join(root, a.dir, 'tasks'), { recursive: true });
fs.writeFileSync(path.join(root, a.dir, 'tasks', '.gitkeep'), '');
fs.writeFileSync(path.join(root, a.dir, 'reviews', '.gitkeep'), '');

writeJSON(path.join(root, '.ai-dev', 'current.json'), { cycle: id, branch, startedAt: nowIso() });
appendHistory(root, id, { type: 'cycle_start', branch });

git(root, ['add', '.ai-dev', a.dir]);
git(root, ['commit', '-m', `chore(C-${num}): start cycle ${id}`]);
console.log(`🚀 サイクル ${id} を開始しました（ブランチ: ${branch}）`);
console.log(`   成果物: ${a.dir}/`);
console.log('   次: /req で要求定義を開始');
