#!/usr/bin/env node
// 並列実装用の作業パッケージ（WP）
//   npm run wp:start -- WP-02   … WP ブランチと worktree を作る（implementation フェーズのみ）
//   npm run wp:merge -- WP-02   … WP の GREEN を確認して、サイクルブランチへ 1 つずつマージする
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, git, currentBranch, readJSON, writeJSON, readText, hashTree, nowIso } from './lib/util.mjs';
import { deriveState, appendHistory } from './lib/state.mjs';
import { artifactPaths } from './lib/config.mjs';
import { parseWorkPackages } from './lib/ids.mjs';
import { loadBranching } from './lib/branching.mjs';

const root = findRoot(process.cwd());
const [sub, wpArg] = process.argv.slice(2);
const wp = (wpArg || '').toUpperCase();
const die = (m) => {
  console.error(`⛔ ${m}`);
  process.exit(1);
};

const state = deriveState(root);
if (!state.cycle) die('アクティブなサイクルがありません');
const cycleBranch = `cycle/${state.cycle}`;
const num = state.cycle.match(/^C-\d+/)[0];
const wpBranch = `wp/${num}/${wp}`;
// worktree はプロジェクトの外（隣）に置く。テストランナーや lint が worktree 内のファイルを拾わないようにするため
const wtDir = path.resolve(root, '..', `${path.basename(root)}.worktrees`, `${num}-${wp}`);
const recFile = path.join(root, '.ai-dev', 'cycles', state.cycle, 'wp', `${wp}.json`);
const design = readText(path.join(root, artifactPaths(state.cycle).design), '');
const wps = parseWorkPackages(design);

if (!/^WP-\d{2,}$/.test(wp)) die('WP ID を指定してください（例: WP-02）');
if (!wps.has(wp)) die(`${wp} は設計書の WP 表にありません`);

if (sub === 'start') {
  if (!loadBranching(root).parallelWorktrees) die('計画（docs/plan.md）で並列実装（worktree）を使わない方針になっています。サイクルブランチで直列に実装してください');
  if (state.phase !== 'implementation') die(`worktree での並列実装は implementation フェーズでのみ開始できます（現在: ${state.phase}）`);
  if (currentBranch(root) !== cycleBranch) die(`サイクルブランチ（${cycleBranch}）上で実行してください`);
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) die('コミットされていない変更があります。先にコミットしてください（worktree は HEAD から作られます）');
  // 依存 WP がマージ済みか
  const row = design.split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.includes(wp) && l.trim().split('|')[1].includes(wp));
  const deps = [...(row || '').matchAll(/WP-\d{2,}/g)].map((m) => m[0]).filter((d) => d !== wp);
  for (const d of deps) {
    const rec = readJSON(path.join(root, '.ai-dev', 'cycles', state.cycle, 'wp', `${d}.json`), null);
    if (!rec?.merged) die(`${wp} は ${d} に依存しています。${d} のマージ後に開始してください。`);
  }
  if (fs.existsSync(wtDir)) die(`worktree が既に存在します: ${wtDir}`);
  if (git(root, ['worktree', 'add', '-b', wpBranch, wtDir, 'HEAD']) === null) die('worktree を作成できませんでした');
  // node_modules を共有（Windows ではジャンクション）
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(wtDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  appendHistory(root, state.cycle, { type: 'wp_start', wp, branch: wpBranch, dir: wtDir });
  console.log(`🌿 ${wp} の worktree を作成しました`);
  console.log(`   ブランチ: ${wpBranch}`);
  console.log(`   場所: ${wtDir}`);
  console.log(`   所有パス: ${wps.get(wp).join(', ')}`);
  console.log(`   implementer にはこの場所の絶対パスで作業させ、最後に（worktree 内で）npm run gate -- wp ${wp} を実行させてください。`);
} else if (sub === 'merge') {
  if (currentBranch(root) !== cycleBranch) die(`サイクルブランチ（${cycleBranch}）上で実行してください`);
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) die('サイクルブランチにコミットされていない変更があります');
  // マージは直列: ロックファイルで同時実行を防ぐ
  const lock = path.join(root, '.ai-dev', '.cache', 'merge.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 10 * 60_000) die('別の WP をマージ中です。完了してから実行してください（マージは 1 つずつ）');
  fs.writeFileSync(lock, String(process.pid));
  try {
    const wtRec = readJSON(path.join(wtDir, '.ai-dev', 'cycles', state.cycle, 'wp', `${wp}.json`), null);
    if (!wtRec || wtRec.status !== 'passed') die(`${wp} の GREEN 記録がありません（worktree 内で npm run gate -- wp ${wp} を実行）`);
    if (wtRec.tree.src !== hashTree(wtDir, 'src') || wtRec.tree.e2e !== hashTree(wtDir, 'e2e')) die(`${wp} は GREEN 判定後に変更されています。再度 gate を実行してください`);
    if (git(wtDir, ['status', '--porcelain', '--untracked-files=no'])) die(`${wp} の worktree に未コミットの変更があります。implementer にコミットさせてください`);
    if (git(root, ['merge', '--no-ff', wpBranch, '-m', `chore(${num}): merge ${wp}`]) === null) {
      git(root, ['merge', '--abort']);
      die(`${wp} のマージで競合が発生したため中止しました。PM は競合箇所を確認し、担当 WP の implementer に解消を依頼してください。`);
    }
    writeJSON(recFile, { ...wtRec, merged: true, mergedAt: nowIso() });
    git(root, ['add', recFile]);
    git(root, ['commit', '-m', `chore(${num}): record ${wp} merged`]);
    // 共有 node_modules のリンクだけを外してから worktree を削除する（リンク先を消さないため）
    const link = path.join(wtDir, 'node_modules');
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      /* リンクなし */
    }
    git(root, ['worktree', 'remove', '--force', wtDir]);
    appendHistory(root, state.cycle, { type: 'wp_merge', wp });
    console.log(`🔀 ${wp} をマージしました。全 WP のマージ後に npm run gate -- GREEN を実行してください。`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
} else {
  die('使い方: npm run wp:start -- WP-xx / npm run wp:merge -- WP-xx');
}
