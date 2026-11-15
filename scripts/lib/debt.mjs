// 技術的負債の台帳（docs/debt.md）とリファクタリングサイクルの判定
//
// 台帳の表（1 行 1 件）: | ID | 内容 | 場所 | 重大度 | 起票元 | 状態 | 解消サイクル / 理由 |
//   ID:     DEBT-001
//   重大度: 高 / 中 / 低
//   起票元: RV-05-003（レビューの保留指摘）/ C-002 retro / 人間 など、根拠が分かるもの（必須）
//   状態:   未対応 / 計画済 / 解消 / 却下
//   最終列: 「解消」なら解消したサイクル ID（C-003-refactor-xxx）、「却下」なら理由（必須）
import path from 'node:path';
import { readText } from './util.mjs';
import { DEBT_FILE, artifactPaths } from './config.mjs';

export const DEBT_STATUSES = ['未対応', '計画済', '解消', '却下'];
export const DEBT_SEVERITIES = ['高', '中', '低'];
export const DEBT_ID = /DEBT-\d{3,}/;

/** リファクタリング専用サイクルか（サイクル名が refactor- で始まる） */
export const isRefactorCycle = (cycleId) => /^C-\d+-refactor-/.test(cycleId || '');

export function parseDebt(text) {
  const items = [];
  for (const line of (text || '').split(/\r?\n/)) {
    if (!/^\s*\|\s*DEBT-\d/.test(line)) continue;
    const c = line.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    items.push({ id: c[0], title: c[1] || '', place: c[2] || '', severity: c[3] || '', source: c[4] || '', status: c[5] || '', note: c[6] || '' });
  }
  return items;
}

/** 台帳の書式の問題 */
export function debtProblems(text) {
  const problems = [];
  const seen = new Set();
  for (const d of parseDebt(text)) {
    if (!DEBT_ID.test(d.id)) problems.push(`${d.id}: ID は DEBT-001 の形式にしてください`);
    if (seen.has(d.id)) problems.push(`${d.id}: ID が重複しています`);
    seen.add(d.id);
    if (!d.title) problems.push(`${d.id}: 内容がありません`);
    if (!DEBT_SEVERITIES.includes(d.severity)) problems.push(`${d.id}: 重大度は ${DEBT_SEVERITIES.join(' / ')} のいずれかです（現在: ${d.severity || '空'}）`);
    if (!d.source) problems.push(`${d.id}: 起票元（レビュー指摘 ID・振り返り・人間）がありません`);
    if (!DEBT_STATUSES.includes(d.status)) problems.push(`${d.id}: 状態は ${DEBT_STATUSES.join(' / ')} のいずれかです（現在: ${d.status || '空'}）`);
    if (d.status === '解消' && !/^C-\d+/.test(d.note)) problems.push(`${d.id}: 「解消」には解消したサイクル ID を書いてください`);
    if (d.status === '却下' && !d.note) problems.push(`${d.id}: 「却下」には理由が必要です`);
  }
  return problems;
}

export const loadDebt = (root) => parseDebt(readText(path.join(root, DEBT_FILE), ''));

/** 未解消（未対応・計画済）の件数 */
export function debtSummary(root, threshold = 5) {
  const open = loadDebt(root).filter((d) => ['未対応', '計画済'].includes(d.status));
  const high = open.filter((d) => d.severity === '高').length;
  const needsRefactor = high > 0 || open.length >= threshold;
  return { open, high, needsRefactor };
}

/** 要求定義の「対象の負債: DEBT-001, DEBT-002」から対象 ID を読む */
export function refactorTargets(reqText) {
  const m = (reqText || '').match(/対象の負債\s*[:：]\s*(.+)/);
  return m ? [...new Set(m[1].match(/DEBT-\d{3,}/g) || [])] : [];
}

/** リファクタリングサイクルの完了条件: 対象の負債がすべてこのサイクルで「解消」になっていること */
export function refactorDebtProblems(root, cycleId) {
  const targets = refactorTargets(readText(path.join(root, artifactPaths(cycleId).req), ''));
  if (!targets.length) return ['要求定義に「対象の負債: DEBT-xxx」がありません（リファクタリングは台帳の負債を 1 件以上対象にする）'];
  const ledger = new Map(loadDebt(root).map((d) => [d.id, d]));
  const problems = [];
  for (const id of targets) {
    const d = ledger.get(id);
    if (!d) problems.push(`${id}: 台帳（${DEBT_FILE}）にありません`);
    else if (d.status !== '解消' || !d.note.startsWith(cycleId)) problems.push(`${id}: 台帳の状態を「解消」にし、解消サイクルに ${cycleId} を書いてください（現在: ${d.status} / ${d.note || '空'}）`);
  }
  return problems;
}
