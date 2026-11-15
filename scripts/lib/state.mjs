// 状態の算出。フェーズは保存せず、ゲート記録と成果物ハッシュから毎回算出する。
// → 承認後に成果物が変われば、自動的に承認が無効になり、フェーズが戻る。
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, hashFile, hashTree, listFiles, matchAny, nowIso } from './util.mjs';
import { artifactPaths, PLAN_FILE, TEST_FILES, CONFIG_FILES } from './config.mjs';

export const PHASES = ['requirements', 'design', 'test_design', 'implementation', 'ai_review', 'final_review', 'done'];

export const STEPS = [
  { id: 'REQ_REVIEW', kind: 'auto', phase: 'requirements' },
  { id: 'G1', kind: 'human', phase: 'requirements' },
  { id: 'DESIGN_REVIEW', kind: 'auto', phase: 'design' },
  { id: 'G2', kind: 'human', phase: 'design' },
  { id: 'RED', kind: 'auto', phase: 'test_design' },
  { id: 'GREEN', kind: 'auto', phase: 'implementation' },
  { id: 'CODE_REVIEW', kind: 'auto', phase: 'ai_review' },
  { id: 'G3', kind: 'human', phase: 'final_review' },
];

export const HUMAN_GATES = ['G0', 'G1', 'G2', 'G3'];

const aiDev = (root, ...p) => path.join(root, '.ai-dev', ...p);

export function readCurrent(root) {
  return readJSON(aiDev(root, 'current.json'), { cycle: null });
}

export function recordPath(root, cycleId, stepId) {
  if (stepId === 'G0') return aiDev(root, 'approvals', 'G0.json');
  const kind = HUMAN_GATES.includes(stepId) ? 'approvals' : 'gates';
  return aiDev(root, 'cycles', cycleId, kind, `${stepId}.json`);
}

export function readRecord(root, cycleId, stepId) {
  return readJSON(recordPath(root, cycleId, stepId), null);
}

/** ロック対象のテストファイル・設定ファイルを列挙 */
export function lockableFiles(root) {
  const files = [...listFiles(root, 'src'), ...listFiles(root, 'e2e')].filter((f) => matchAny(f, TEST_FILES));
  const configs = fs
    .readdirSync(root)
    .filter((f) => matchAny(f, CONFIG_FILES))
    .concat(listFiles(root, 'src/test').filter((f) => matchAny(f, CONFIG_FILES)));
  return [...new Set([...files, ...configs])].sort();
}

/** ステップ記録時に保存する成果物のハッシュ一覧（上流の成果物も累積して含める） */
export function computeArtifacts(root, cycleId, stepId) {
  const a = artifactPaths(cycleId);
  const files = [];
  const trees = [];
  if (stepId === 'G0') {
    files.push(PLAN_FILE);
  } else {
    files.push(a.req, a.rvReq);
    if (['DESIGN_REVIEW', 'G2', 'RED', 'GREEN', 'CODE_REVIEW', 'G3'].includes(stepId)) files.push(a.design, a.rvDesign);
    if (['RED', 'GREEN', 'CODE_REVIEW', 'G3'].includes(stepId)) files.push(a.testPlan, a.rvTest);
    if (stepId === 'RED') files.push(...lockableFiles(root));
    if (['GREEN', 'CODE_REVIEW', 'G3'].includes(stepId)) {
      files.push(...lockableFiles(root).filter((f) => matchAny(f, CONFIG_FILES)));
      trees.push('src', 'e2e', 'public');
      files.push('index.html', 'package.json');
    }
    if (['CODE_REVIEW', 'G3'].includes(stepId)) files.push(a.rvCode);
  }
  const out = {};
  for (const f of files) out[`file:${f}`] = hashFile(path.join(root, f));
  for (const t of trees) out[`tree:${t}`] = hashTree(root, t);
  return out;
}

/** 記録された成果物ハッシュが現在と一致するか。不一致のキーを返す */
export function staleKeys(root, record) {
  if (!record || !record.artifacts) return ['(no record)'];
  const stale = [];
  for (const [key, h] of Object.entries(record.artifacts)) {
    const [type, ...rest] = key.split(':');
    const p = rest.join(':');
    const cur = type === 'tree' ? hashTree(root, p) : hashFile(path.join(root, p));
    if (cur !== h) stale.push(p);
  }
  return stale;
}

export function isRecordValid(root, record) {
  if (!record) return false;
  if (!['passed', 'approved'].includes(record.status)) return false;
  return staleKeys(root, record).length === 0;
}

/** RED 時にロックしたテストファイル */
export function lockedTests(root, cycleId) {
  const red = readRecord(root, cycleId, 'RED');
  if (!red || red.status !== 'passed') return [];
  return Object.keys(red.artifacts)
    .filter((k) => k.startsWith('file:'))
    .map((k) => k.slice(5))
    .filter((f) => matchAny(f, TEST_FILES) || matchAny(f, CONFIG_FILES));
}

export function maintenanceActive(root) {
  const m = readJSON(aiDev(root, 'maintenance.json'), null);
  if (!m || !m.until) return false;
  return Date.parse(m.until) > Date.now();
}

/** 現在の状態を算出する */
export function deriveState(root) {
  const current = readCurrent(root);
  const g0 = readRecord(root, null, 'G0');
  const g0Valid = isRecordValid(root, g0);
  const base = { root, cycle: current.cycle || null, g0: { record: g0, valid: g0Valid }, maintenance: maintenanceActive(root) };

  if (!g0Valid) return { ...base, phase: 'planning', steps: [], blockingStep: { id: 'G0', kind: 'human', record: g0 } };
  if (!current.cycle) return { ...base, phase: 'idle', steps: [], blockingStep: null };

  const steps = STEPS.map((s) => {
    const record = readRecord(root, current.cycle, s.id);
    return { ...s, record, valid: isRecordValid(root, record), stale: record ? staleKeys(root, record) : [] };
  });
  const blocking = steps.find((s) => !s.valid) || null;
  return { ...base, phase: blocking ? blocking.phase : 'done', steps, blockingStep: blocking };
}

/** 人間向け・AI 向けの「次にやること」 */
export function nextAction(state) {
  const b = state.blockingStep;
  if (state.phase === 'planning') {
    if (b?.record?.status === 'rejected') return `G0 が差し戻されました（理由: ${b.record.reason}）。docs/plan.md を修正し、人間の承認を依頼してください。`;
    return '/plan で docs/plan.md（開発手法・ロードマップ・バックログ）を作成 → 人間が `npm run approve -- G0`';
  }
  if (state.phase === 'idle') return '/cycle-new でサイクルを開始してください（npm run cycle:new -- <短い名前>）';
  if (state.phase === 'done') return 'サイクル完了。/retro で振り返り → 人間が PR をマージ → /cycle-new で次のサイクルへ';
  const rejected = b.record?.status === 'rejected' ? `（${b.id} 差し戻し: ${b.record.reason}）` : b.record?.status === 'invalidated' ? `（${b.record.reason}）` : '';
  const stale = b.record && b.stale?.length && b.record.status === 'passed' ? `（${b.id} の記録後に変更あり: ${b.stale.slice(0, 3).join(', ')}）` : '';
  const map = {
    REQ_REVIEW: '要求定義を作成 → /review-req（コールドレビュー）→ `npm run gate -- REQ_REVIEW`',
    G1: '人間の承認待ち: `npm run approve -- G1`',
    DESIGN_REVIEW: '設計を作成 → /review-design → `npm run gate -- DESIGN_REVIEW`',
    G2: '人間の承認待ち: `npm run approve -- G2`',
    RED: 'テスト設計・テストコード作成 → テストレビュー → `npm run gate -- RED`',
    GREEN: 'TDD で実装 → `npm run gate -- GREEN`',
    CODE_REVIEW: '/review-code（観点別に並列のコールドレビュー）→ `npm run gate -- CODE_REVIEW`',
    G3: '`npm run pr:create` で PR を作成 → 人間が PR を確認し `npm run approve -- G3` → 人間がマージ',
  };
  return `${map[b.id]}${rejected}${stale}`;
}

/** 状態変化の履歴（追記のみ） */
export function appendHistory(root, cycleId, event) {
  const file = cycleId ? aiDev(root, 'cycles', cycleId, 'history.jsonl') : aiDev(root, 'history.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: nowIso(), ...event }) + '\n');
}

/**
 * 人間の差し戻し。差し戻したゲートの直前の自動ゲートも無効にし、作業できるフェーズへ戻す。
 * 例: G3 を差し戻すと GREEN と CODE_REVIEW が無効になり、implementation に戻る（コードを直せる）
 */
export const REJECT_INVALIDATES = { G0: [], G1: ['REQ_REVIEW'], G2: ['DESIGN_REVIEW'], G3: ['GREEN', 'CODE_REVIEW'] };

export function rejectGate(root, cycleId, gate, { by, reason }) {
  writeRecord(root, cycleId, gate, { step: gate, status: 'rejected', at: nowIso(), by, reason, artifacts: computeArtifacts(root, cycleId, gate) });
  const idx = STEPS.findIndex((s) => s.id === gate);
  const later = idx >= 0 ? STEPS.slice(idx + 1).map((s) => s.id) : [];
  for (const s of new Set([...(REJECT_INVALIDATES[gate] || []), ...later])) {
    const rec = readRecord(root, cycleId, s);
    if (rec) writeRecord(root, cycleId, s, { ...rec, status: 'invalidated', reason: `${gate} の差し戻しにより無効: ${reason}`, invalidatedAt: nowIso() });
  }
}

export function writeRecord(root, cycleId, stepId, record) {
  writeJSON(recordPath(root, cycleId, stepId), record);
  appendHistory(root, stepId === 'G0' ? null : cycleId, { type: 'record', step: stepId, status: record.status, by: record.by });
}
