// ブランチ戦略（SSOT: G0 で承認された docs/plan.md の ai-dev:branching ブロック）
//
// docs/plan.md に次のブロックを書く（PM が人間に聞いて提案し、G0 で承認される）:
// ```json ai-dev:branching
// { "strategy": "github-flow", "mergeMethod": "merge", "parallelWorktrees": true }
// ```
import path from 'node:path';
import { readText, git } from './util.mjs';
import { PLAN_FILE } from './config.mjs';

export const PRESETS = {
  // main ← cycle/* ← wp/*。小〜中規模・1 チーム向け（推奨の既定値）
  'github-flow': { base: 'main', release: null },
  // main ← develop ← cycle/* ← wp/*。リリースをまとめて出す・検証環境がある場合向け
  'git-flow-lite': { base: 'develop', release: 'main' },
};

export const MERGE_METHODS = ['merge', 'squash'];

export const DEFAULT_BRANCHING = { strategy: 'github-flow', base: 'main', release: null, mergeMethod: 'merge', parallelWorktrees: true, source: 'default' };

const BLOCK_RE = /```json\s+ai-dev:branching\s*\r?\n([\s\S]*?)```/;

/** 計画書からブランチ戦略を読む。書かれていなければ既定値（github-flow） */
export function loadBranching(root) {
  const text = readText(path.join(root, PLAN_FILE), '');
  const m = text && text.match(BLOCK_RE);
  if (!m) return { ...DEFAULT_BRANCHING };
  let raw;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return { ...DEFAULT_BRANCHING, error: 'docs/plan.md の ai-dev:branching ブロックが正しい JSON ではありません' };
  }
  const preset = PRESETS[raw.strategy];
  if (!preset) return { ...DEFAULT_BRANCHING, error: `strategy は ${Object.keys(PRESETS).join(' / ')} のいずれかです` };
  return {
    strategy: raw.strategy,
    ...preset,
    mergeMethod: MERGE_METHODS.includes(raw.mergeMethod) ? raw.mergeMethod : 'merge',
    parallelWorktrees: raw.parallelWorktrees !== false,
    source: PLAN_FILE,
  };
}

/** 統合ブランチとの分岐点（origin を優先） */
export function mergeBase(root) {
  const b = loadBranching(root).base;
  return git(root, ['merge-base', 'HEAD', `origin/${b}`]) || git(root, ['merge-base', 'HEAD', b]);
}

/** AI が直接コミット・マージできない（PR 経由でのみ更新する）ブランチ */
export function protectedBranches(b) {
  return [...new Set(['main', 'master', b.base, b.release].filter(Boolean))];
}

export function describeBranching(b) {
  const flow = b.release ? `${b.release} ← ${b.base} ← cycle/* ← wp/*` : `${b.base} ← cycle/* ← wp/*`;
  return `${b.strategy}（${flow}）/ マージ方式: ${b.mergeMethod === 'merge' ? 'マージコミット' : 'squash'} / 並列実装（worktree）: ${b.parallelWorktrees ? 'あり' : 'なし'}`;
}
