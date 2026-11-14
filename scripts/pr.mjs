#!/usr/bin/env node
// PR の作成: npm run pr:create
// CODE_REVIEW 通過後（final_review フェーズ）に、サイクルブランチ → main の PR を作る。
// マージは人間だけが行う（AI からの gh pr merge はフックでブロック）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRoot, git, currentBranch, readText } from './lib/util.mjs';
import { deriveState } from './lib/state.mjs';
import { artifactPaths } from './lib/config.mjs';
import { buildTrace, renderMatrix } from './lib/trace.mjs';
import { parseReview } from './lib/ids.mjs';
import { reviewRunSummary } from './lib/review-evidence.mjs';

const root = findRoot(process.cwd());
const die = (m) => {
  console.error(`⛔ ${m}`);
  process.exit(1);
};
const state = deriveState(root);
if (state.phase !== 'final_review') die(`PR は final_review フェーズで作成します（現在: ${state.phase}）`);
const branch = currentBranch(root);
if (branch !== `cycle/${state.cycle}`) die(`サイクルブランチ（cycle/${state.cycle}）上で実行してください`);

const a = artifactPaths(state.cycle);
const num = state.cycle.match(/^C-\d+/)[0];

// トレーサビリティを再生成してコミット
const t = buildTrace(root, state.cycle);
fs.writeFileSync(path.join(root, a.trace), renderMatrix(t, state.cycle));
git(root, ['add', a.trace]);
git(root, ['commit', '-m', `docs(${num}): update traceability`, '--', a.trace]);
if (git(root, ['status', '--porcelain', '--untracked-files=no'])) die('コミットされていない変更があります。先にコミットしてください');

// 本文を組み立てる
const reqText = readText(path.join(root, a.req), '');
const title = (reqText.match(/^#\s+(.+)$/m)?.[1] || state.cycle).replace(/^要求定義[:：]?\s*/, '');
const reviewSummary = [a.rvReq, a.rvDesign, a.rvTest, a.rvCode]
  .map((f) => {
    const { findings } = parseReview(readText(path.join(root, f), ''));
    const c = (s) => findings.filter((x) => x.severity === s).length;
    const pending = findings.filter((x) => /保留|却下/.test(x.status));
    return `| ${path.basename(f)} | ${c('Critical')} | ${c('Major')} | ${c('Minor')} | ${pending.map((p) => `${p.id}: ${p.action}`).join('<br>') || '-'} |`;
  })
  .join('\n');
const approvals = state.steps
  .filter((s) => s.kind === 'human' && s.valid)
  .map((s) => `- ${s.id}: ${s.record.by}（${s.record.at.slice(0, 16)}）${s.record.comment ? ` — ${s.record.comment}` : ''}`)
  .join('\n');
const green = state.steps.find((s) => s.id === 'GREEN')?.record;
const reqList = [...t.reqs.values()].map((r) => `- ${r.id}（${r.priority}）`).join('\n');
const runs = reviewRunSummary(root, state.cycle);
const runTable = runs.length
  ? `| レビュー | 観点 | reviewer（エージェント ID） | モデル | 日時 |\n|---|---|---|---|---|\n${runs.map((r) => `| ${r.rv} | ${r.perspective} | ${r.agent} | ${r.models} | ${r.at.slice(0, 16)} |`).join('\n')}`
  : '-';

let body = readText(path.join(root, 'docs', 'templates', 'pr_body.md'), '{{ALL}}');
const vars = {
  CYCLE: state.cycle,
  REQUIREMENTS: reqList,
  TRACE: renderMatrix(t, state.cycle).split('\n').slice(4).join('\n'),
  CHECKS: (green?.checks || []).map((c) => `- ${c.name}: ${c.code === 0 ? '✅' : '❌'}（${Math.round(c.ms / 1000)}s）`).join('\n') || '-',
  REVIEWS: `| 記録 | Critical | Major | Minor | 保留・却下（理由） |\n|---|---|---|---|---|\n${reviewSummary}\n\n**相互レビューの実施記録**（作成者とは別の reviewer が、経緯を渡されずに実施）\n\n${runTable}`,
  APPROVALS: approvals || '-',
};
for (const [k, v] of Object.entries(vars)) body = body.replaceAll(`{{${k}}}`, v);
const bodyFile = path.join(root, '.ai-dev', '.cache', 'pr_body.md');
fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
fs.writeFileSync(bodyFile, body);

// push → PR 作成（既にあれば本文を更新）
if (git(root, ['push', '-u', 'origin', branch]) === null) die('push に失敗しました');
const gh = findGh();
if (!gh) die(`GitHub CLI（gh）が見つかりません。PR 本文は ${bodyFile} に出力しました。ブラウザから PR を作成してください。`);
const run = (args) => execFileSync(gh, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let url;
try {
  url = run(['pr', 'view', branch, '--json', 'url', '-q', '.url']);
  run(['pr', 'edit', branch, '--body-file', bodyFile]);
  console.log(`🔁 既存の PR の本文を更新しました: ${url}`);
} catch {
  url = run(['pr', 'create', '--base', 'main', '--head', branch, '--title', `${num}: ${title}`, '--body-file', bodyFile]);
  console.log(`📬 PR を作成しました: ${url}`);
}
console.log('   次: 人間が PR を確認 → npm run approve -- G3 → 人間がマージ');

function findGh() {
  const candidates = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* 次へ */
    }
  }
  return null;
}
