#!/usr/bin/env node
// サイクルの開始: npm run cycle:new -- <短い名前(英小文字・数字・ハイフン)>
// G0（開発計画）承認済みで、前のサイクルが完了（または未開始）のときだけ開始できる。
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, git, writeJSON, nowIso } from './lib/util.mjs';
import { deriveState, appendHistory } from './lib/state.mjs';
import { artifactPaths } from './lib/config.mjs';
import { loadBranching } from './lib/branching.mjs';
import { loadDebt, DEBT_ID } from './lib/debt.mjs';

const root = findRoot(process.cwd());
// 使い方: cycle:new -- [--refactor --debt DEBT-001,DEBT-002] <短い名前>
const argv = process.argv.slice(2);
const sub = argv[0];
const refactor = argv.includes('--refactor');
const di = argv.indexOf('--debt');
const debtArg = di >= 0 ? argv[di + 1] || '' : '';
const slugArg = argv.slice(1).find((x, i, arr) => !x.startsWith('--') && arr[i - 1] !== '--debt');

function die(msg) {
  console.error(`⛔ ${msg}`);
  process.exit(1);
}

if (sub !== 'new') die('使い方: npm run cycle:new -- <短い名前>');
const baseSlug = (slugArg || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
const slug = refactor && baseSlug ? `refactor-${baseSlug}` : baseSlug;
// リファクタリングサイクルは台帳（docs/debt.md）の未解消の負債を 1 件以上指定する
const debtIds = refactor ? [...new Set(debtArg.match(new RegExp(DEBT_ID.source, 'g')) || [])] : [];
if (refactor) {
  if (!debtIds.length) die('--refactor には --debt DEBT-001[,DEBT-002] で対象の負債を指定してください（台帳: docs/debt.md、npm run debt）');
  const ledger = new Map(loadDebt(root).map((d) => [d.id, d]));
  for (const id of debtIds) {
    const d = ledger.get(id);
    if (!d) die(`${id} は台帳（docs/debt.md）にありません`);
    if (!['未対応', '計画済'].includes(d.status)) die(`${id} の状態は「${d.status}」です。対象にできるのは未対応・計画済の負債だけです`);
  }
}
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

// ブランチ戦略（G0 で承認済みの docs/plan.md）の統合ブランチから分岐
const branching = loadBranching(root);
if (branching.error) die(branching.error);
git(root, ['fetch', 'origin', branching.base]);
const base = git(root, ['rev-parse', '--verify', `origin/${branching.base}`]) ? `origin/${branching.base}` : git(root, ['rev-parse', '--verify', branching.base]) ? branching.base : null;
if (!base) die(`統合ブランチ ${branching.base} がありません。人間が作成してください（例: git push origin main:${branching.base}）`);
// 分岐元に G0 の承認記録があるか（なければ新しいブランチは planning で止まる）
if (git(root, ['cat-file', '-e', `${base}:.ai-dev/approvals/G0.json`]) === null) die(`分岐元（${base}）に G0 の承認記録がありません。plan/* の PR をマージしてから開始してください`);
// 前のサイクルが統合ブランチにマージ済みか
if (state.phase === 'done' && state.cycle) {
  const prev = git(root, ['rev-parse', '--verify', `cycle/${state.cycle}`]) ? `cycle/${state.cycle}` : 'HEAD';
  if (git(root, ['merge-base', '--is-ancestor', prev, base]) === null) die(`前のサイクル（${state.cycle}）がまだ ${base} にマージされていません。PR のマージ後に開始してください`);
}
if (git(root, ['switch', '-c', branch, base]) === null) die(`ブランチ ${branch} を作成できませんでした`);

// 成果物フォルダとテンプレート
const a = artifactPaths(id);
const tpl = (name) => path.join(root, 'docs', 'templates', name);
const copies = [
  [refactor ? '01_requirements_refactor.md' : '01_requirements.md', a.req],
  ['02_design.md', a.design],
  ['03_test_plan.md', a.testPlan],
];
for (const [t, dest] of copies) {
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  if (fs.existsSync(tpl(t))) fs.writeFileSync(path.join(root, dest), fs.readFileSync(tpl(t), 'utf8').replaceAll('{{CYCLE}}', id).replaceAll('{{DEBT}}', debtIds.join(', ')));
}
fs.mkdirSync(path.join(root, a.dir, 'reviews'), { recursive: true });
fs.mkdirSync(path.join(root, a.dir, 'tasks'), { recursive: true });
fs.writeFileSync(path.join(root, a.dir, 'tasks', '.gitkeep'), '');
fs.writeFileSync(path.join(root, a.dir, 'reviews', '.gitkeep'), '');

writeJSON(path.join(root, '.ai-dev', 'current.json'), { cycle: id, branch, startedAt: nowIso() });
appendHistory(root, id, { type: 'cycle_start', branch });

git(root, ['add', '.ai-dev', a.dir]);
git(root, ['commit', '-m', `chore(C-${num}): start cycle ${id}`]);
console.log(`🚀 サイクル ${id} を開始しました（ブランチ: ${branch}、分岐元: ${base}）`);
console.log(`   成果物: ${a.dir}/`);
console.log('   次: /req で要求定義を開始');
