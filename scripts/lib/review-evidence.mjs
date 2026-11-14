// 相互レビュー（コールドレビュー）の強制と証跡
//
// 1. 依頼の検査: reviewer への指示文は決められた 4 行だけ（経緯・意見を渡せない）
// 2. 実施記録: reviewer の終了時に、フックが観点・対象ハッシュ・読んだファイル・モデル・生の指摘を記録
// 3. 照合: 作成者とは別のエージェントが、1 回の指示だけで、全観点を、最終版に対して実施したかをゲートで確認
import fs from 'node:fs';
import path from 'node:path';
import { readText, hashFile, hashTree, listFiles, toRel, nowIso } from './util.mjs';
import { artifactPaths, loadConfig } from './config.mjs';

export const RV_PHASES = {
  'RV-01': ['requirements'],
  'RV-02': ['design'],
  'RV-03': ['test_design'],
  'RV-05': ['implementation', 'ai_review'],
};

const FIELDS = ['レビュー番号', '観点', '対象', '基準'];
const MAX_PROMPT = 1500;

const evidenceDir = (root, cycle) => path.join(root, '.ai-dev', 'cycles', cycle, 'reviews');
const runsFile = (root, cycle) => path.join(evidenceDir(root, cycle), 'runs.jsonl');
const activityFile = (root, cycle) => path.join(root, '.ai-dev', 'cycles', cycle, 'activity.jsonl');

/** 依頼文を解析する: { fields, extra: 余分な行 } */
export function parseReviewRequest(prompt) {
  const fields = {};
  const extra = [];
  for (const raw of String(prompt || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[-*]?\s*([^:：]+)[:：]\s*(.*)$/);
    if (m && FIELDS.includes(m[1].trim())) fields[m[1].trim()] = m[2].trim();
    else extra.push(line);
  }
  return { fields, extra };
}

const splitPaths = (v) => (v || '').split(/[,、\s]+/).map((s) => s.replace(/[`'"]/g, '').replace(/\\/g, '/').replace(/\/$/, '')).filter(Boolean);

/** reviewer 起動時の依頼文の検査 */
export function checkReviewRequest({ root, prompt, state }) {
  const config = loadConfig(root);
  const deny = (reason) => ({
    allow: false,
    reason: `レビュー依頼の形式が正しくありません: ${reason}`,
    hint: 'reviewer への指示は次の 4 行だけにしてください（経緯・意見・作成者の説明は書かない）:\nレビュー番号: RV-05\n観点: セキュリティ\n対象: src/features/add/, src/App.tsx\n基準: docs/cycles/<サイクル>/02_design.md',
  });
  if (String(prompt || '').length > MAX_PROMPT) return deny(`長すぎます（${MAX_PROMPT} 文字以内）`);
  const { fields, extra } = parseReviewRequest(prompt);
  for (const f of FIELDS) if (!fields[f]) return deny(`「${f}:」の行がありません`);
  if (extra.length) return deny(`決められた 4 行以外の記述があります（「${extra[0].slice(0, 40)}」）`);
  const rv = fields['レビュー番号'].match(/RV-\d{2}/)?.[0];
  if (!rv || !RV_PHASES[rv]) return deny('レビュー番号は RV-01 / RV-02 / RV-03 / RV-05 のいずれかです');
  if (!state.cycle) return deny('アクティブなサイクルがありません');
  if (!RV_PHASES[rv].includes(state.phase)) return deny(`${rv} は ${RV_PHASES[rv].join(' / ')} フェーズで行います（現在: ${state.phase}）`);
  const allowed = config.reviewPerspectives[rv] || [];
  if (!allowed.includes(fields['観点'])) return deny(`${rv} の観点は次のいずれかです: ${allowed.join(' / ')}`);
  for (const key of ['対象', '基準']) {
    const ps = splitPaths(fields[key]);
    if (!ps.length) return deny(`「${key}」にパスがありません`);
    for (const p of ps) {
      const rel = toRel(root, p);
      if (rel === null || !fs.existsSync(path.join(root, rel))) return deny(`「${key}」のパスが見つかりません: ${p}`);
    }
  }
  return { allow: true };
}

/** パス（ファイル or ディレクトリ）のハッシュ */
function hashPath(root, rel) {
  const abs = path.join(root, rel);
  try {
    return fs.statSync(abs).isDirectory() ? `tree:${hashTree(root, rel)}` : hashFile(abs);
  } catch {
    return 'MISSING';
  }
}

/** サブエージェントの履歴（JSONL）から、指示文・指示の回数・読んだファイル・モデルを取り出す */
export function readTranscript(transcriptPath) {
  const out = { prompts: [], reads: [], models: new Set() };
  const text = readText(transcriptPath, '');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = e.message;
    if (e.type === 'user' && msg && !e.isMeta) {
      const c = msg.content;
      const parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
      if (parts.some((p) => p.type === 'tool_result')) continue;
      const t = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
      if (t && !t.startsWith('<')) out.prompts.push(t);
    }
    if (e.type === 'assistant' && msg) {
      if (msg.model) out.models.add(msg.model);
      for (const p of Array.isArray(msg.content) ? msg.content : []) {
        if (p.type === 'tool_use' && ['Read', 'Glob', 'Grep'].includes(p.name)) {
          const fp = p.input?.file_path || p.input?.path;
          if (fp) out.reads.push(fp);
        }
      }
    }
  }
  return { ...out, models: [...out.models] };
}

/** reviewer の終了時に実施記録を残す（SubagentStop フックから呼ばれる） */
export function recordReviewRun({ root, state, input }) {
  if (!state.cycle) return null;
  const tr = readTranscript(input.agent_transcript_path);
  const prompt = tr.prompts[0] || '';
  const { fields } = parseReviewRequest(prompt);
  const rv = fields['レビュー番号']?.match(/RV-\d{2}/)?.[0] || null;
  const toMap = (v) => Object.fromEntries(splitPaths(v).map((p) => toRel(root, p)).filter((p) => p !== null).map((p) => [p, hashPath(root, p)]));
  const run = {
    at: nowIso(),
    agent_id: input.agent_id,
    agent_type: input.agent_type,
    rv,
    perspective: fields['観点'] || null,
    targets: toMap(fields['対象']),
    basis: toMap(fields['基準']),
    prompts: tr.prompts.length,
    reads: [...new Set(tr.reads.map((r) => toRel(root, r)).filter((r) => r !== null))],
    models: tr.models,
  };
  fs.mkdirSync(path.join(evidenceDir(root, state.cycle), 'raw'), { recursive: true });
  fs.appendFileSync(runsFile(root, state.cycle), JSON.stringify(run) + '\n');
  // 生の指摘（aggregator が記録をまとめる前の原文）を証跡として残す
  fs.writeFileSync(
    path.join(evidenceDir(root, state.cycle), 'raw', `${input.agent_id}.md`),
    `# ${rv || '?'} / ${run.perspective || '?'} / ${input.agent_id}\n\n## 指示\n\n${prompt}\n\n## 指摘（原文）\n\n${input.last_assistant_message || ''}\n`,
  );
  return run;
}

/** ファイルを書いたエージェントの記録（PostToolUse フックから呼ばれる） */
export function recordActivity({ root, state, input, rel }) {
  if (!state.cycle) return;
  fs.mkdirSync(path.dirname(activityFile(root, state.cycle)), { recursive: true });
  fs.appendFileSync(activityFile(root, state.cycle), JSON.stringify({ at: nowIso(), agent_id: input.agent_id || 'main', agent_type: input.agent_type || 'main', tool: input.tool_name, file: rel }) + '\n');
}

const readJsonl = (f) =>
  (readText(f, '') || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

export const loadRuns = (root, cycle) => readJsonl(runsFile(root, cycle));
export const loadActivity = (root, cycle) => readJsonl(activityFile(root, cycle));

/** そのレビューが必ずカバーすべきファイル */
function requiredTargets(root, cycle, rv) {
  const a = artifactPaths(cycle);
  if (rv === 'RV-01') return [a.req];
  if (rv === 'RV-02') return [a.design];
  if (rv === 'RV-03') return [a.testPlan, ...[...listFiles(root, 'src'), ...listFiles(root, 'e2e')].filter((f) => /\.(test|spec)\./.test(f) || f.startsWith('e2e/'))];
  if (rv === 'RV-05') return [...listFiles(root, 'src'), ...listFiles(root, 'e2e')];
  return [];
}

const covers = (targets, file) => Object.keys(targets).some((t) => t === file || file.startsWith(t + '/'));

/** ゲートでの照合。問題の一覧を返す（空なら合格） */
export function reviewEvidenceProblems(root, cycle, rv, { checkTargets = true } = {}) {
  const config = loadConfig(root);
  if (config.requireReviewEvidence === false) return [];
  const required = config.reviewPerspectives[rv] || [];
  const runs = loadRuns(root, cycle);
  const activity = loadActivity(root, cycle);
  const mustCover = requiredTargets(root, cycle, rv);
  const seen = new Map();
  for (const r of runs) seen.set(r.agent_id, (seen.get(r.agent_id) || 0) + 1);

  const problems = [];
  for (const perspective of required) {
    const candidates = runs.filter((r) => r.rv === rv && r.perspective === perspective);
    if (!candidates.length) {
      problems.push(`${rv}「${perspective}」: reviewer による実施記録がありません`);
      continue;
    }
    const reasons = [];
    const ok = candidates.some((r) => {
      const why = [];
      if (r.agent_type !== 'reviewer') why.push('reviewer 以外のエージェント');
      if (r.prompts !== 1 || seen.get(r.agent_id) > 1) why.push('新規起動ではない（指示が複数回・再利用）');
      const authors = new Set(activity.filter((x) => covers(r.targets, x.file)).map((x) => x.agent_id));
      if (authors.has(r.agent_id)) why.push('対象ファイルの作成者自身');
      if (checkTargets) {
        const stale = Object.entries(r.targets).filter(([p, h]) => hashPath(root, p) !== h).map(([p]) => p);
        if (stale.length) why.push(`レビュー後に対象が変更された（${stale.slice(0, 2).join(', ')}）`);
        const uncovered = mustCover.filter((f) => !covers(r.targets, f));
        if (uncovered.length) why.push(`対象に含まれていないファイルがある（${uncovered.slice(0, 2).join(', ')}）`);
      }
      const readSome = Object.keys(r.targets).every((t) => r.reads.some((x) => x === t || x.startsWith(t + '/') || t.startsWith(x + '/')));
      if (!readSome) why.push('対象ファイルを読んだ記録がない');
      if (why.length) reasons.push(why.join('・'));
      return why.length === 0;
    });
    if (!ok) problems.push(`${rv}「${perspective}」: 有効な実施記録がありません（${reasons[reasons.length - 1]}）。新しい reviewer で最終版をレビューしてください`);
  }
  return problems;
}

/** PR 本文・状態表示用の要約 */
export function reviewRunSummary(root, cycle) {
  return loadRuns(root, cycle).map((r) => ({ rv: r.rv, perspective: r.perspective, agent: r.agent_id, models: (r.models || []).join(', '), at: r.at }));
}
