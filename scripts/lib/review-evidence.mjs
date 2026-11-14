// 相互レビュー（コールドレビュー）の強制と証跡
//
// 1. 依頼の検査: reviewer への指示文は決められた 4 行だけ（経緯・意見を渡せない）
// 2. 実施記録: reviewer の終了時に、フックが観点・対象ハッシュ・読んだファイル・モデル・生の指摘を記録
// 3. 照合: 作成者とは別のエージェントが、1 回の指示だけで、全観点を、最終版に対して実施したかをゲート・CI で確認
//
// 記録の単位（scope）
//   - 製品開発: サイクル ID（.ai-dev/cycles/<サイクル>/）
//   - 基盤の変更（RV-PF）: ブランチ（.ai-dev/platform/<ブランチ>/）
import fs from 'node:fs';
import path from 'node:path';
import { readText, hashFile, hashTree, listFiles, toRel, nowIso, matchAny, git, currentBranch } from './util.mjs';
import { artifactPaths, loadConfig, PLATFORM } from './config.mjs';
import { loadBranching } from './branching.mjs';
import { reviewProblems } from './ids.mjs';

export const RV_PHASES = {
  'RV-01': ['requirements'],
  'RV-02': ['design'],
  'RV-03': ['test_design'],
  'RV-05': ['implementation', 'ai_review'],
  'RV-PF': null, // 基盤のレビュー: フェーズではなく、メンテナンスモード中か feature/* ブランチで行う
};

const FIELDS = ['レビュー番号', '観点', '対象', '基準'];
const MAX_PROMPT = 1500;

export const platformScope = (branch) => `platform/${String(branch || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_')}`;
const scopeDir = (root, scope) => (scope.startsWith('platform/') ? path.join(root, '.ai-dev', ...scope.split('/')) : path.join(root, '.ai-dev', 'cycles', scope));
const runsFile = (root, scope) => path.join(scopeDir(root, scope), 'reviews', 'runs.jsonl');
const activityFile = (root, scope) => path.join(scopeDir(root, scope), 'activity.jsonl');

/** 基盤ファイル（ゲートの仕組みそのもの）か */
export const isPlatformFile = (rel) => matchAny(rel, PLATFORM) || rel === 'package.json' || rel === '.ai-dev/config.json';

/** 基盤のレビュー記録（指摘表）の場所 */
export const platformReviewDoc = (branch) => `docs/memo/reviews/RV-PF_${String(branch).replace(/[^A-Za-z0-9._-]+/g, '_')}.md`;

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
export function checkReviewRequest({ root, prompt, state, branch }) {
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
  const rv = fields['レビュー番号'].match(/RV-(\d{2}|PF)/)?.[0];
  if (!rv || !(rv in RV_PHASES)) return deny('レビュー番号は RV-01 / RV-02 / RV-03 / RV-05 / RV-PF のいずれかです');
  if (rv === 'RV-PF') {
    const b = branch ?? currentBranch(root);
    if (!(state.maintenance || /^feature\//.test(b))) return deny('RV-PF（基盤のレビュー）は、メンテナンスモード中か feature/* ブランチで行います');
  } else {
    if (!state.cycle) return deny('アクティブなサイクルがありません');
    if (!RV_PHASES[rv].includes(state.phase)) return deny(`${rv} は ${RV_PHASES[rv].join(' / ')} フェーズで行います（現在: ${state.phase}）`);
  }
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
export function recordReviewRun({ root, state, input, branch }) {
  const tr = readTranscript(input.agent_transcript_path);
  const prompt = tr.prompts[0] || '';
  const { fields } = parseReviewRequest(prompt);
  const rv = fields['レビュー番号']?.match(/RV-(\d{2}|PF)/)?.[0] || null;
  const scope = rv === 'RV-PF' ? platformScope(branch ?? currentBranch(root)) : state.cycle;
  if (!scope) return null;
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
  const dir = path.join(scopeDir(root, scope), 'reviews');
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.appendFileSync(runsFile(root, scope), JSON.stringify(run) + '\n');
  // 生の指摘（記録をまとめる前の原文）を証跡として残す
  fs.writeFileSync(
    path.join(dir, 'raw', `${input.agent_id}.md`),
    `# ${rv || '?'} / ${run.perspective || '?'} / ${input.agent_id}\n\n## 指示\n\n${prompt}\n\n## 指摘（原文）\n\n${input.last_assistant_message || ''}\n`,
  );
  return run;
}

/** ファイルを書いたエージェントの記録（PostToolUse フックから呼ばれる） */
export function recordActivity({ root, state, input, rel, branch }) {
  const entry = JSON.stringify({ at: nowIso(), agent_id: input.agent_id || 'main', agent_type: input.agent_type || 'main', tool: input.tool_name, file: rel }) + '\n';
  const scopes = [];
  if (state.cycle) scopes.push(state.cycle);
  if (isPlatformFile(rel)) scopes.push(platformScope(branch ?? currentBranch(root)));
  for (const s of scopes) {
    fs.mkdirSync(path.dirname(activityFile(root, s)), { recursive: true });
    fs.appendFileSync(activityFile(root, s), entry);
  }
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

export const loadRuns = (root, scope) => readJsonl(runsFile(root, scope));
export const loadActivity = (root, scope) => readJsonl(activityFile(root, scope));

/** 統合ブランチから変更された（未コミットを含む）基盤ファイル */
export function changedPlatformFiles(root) {
  const b = loadBranching(root).base;
  const base = git(root, ['merge-base', 'HEAD', `origin/${b}`]) || git(root, ['merge-base', 'HEAD', b]);
  if (!base) return [];
  const changed = (git(root, ['diff', '--name-only', base]) || '').split(/\r?\n/);
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) || '').split(/\r?\n/);
  return [...new Set([...changed, ...untracked])].filter(Boolean).filter((f) => isPlatformFile(f) && fs.existsSync(path.join(root, f))).sort();
}

/** そのレビューが必ずカバーすべきファイル */
function requiredTargets(root, scope, rv) {
  if (rv === 'RV-PF') return changedPlatformFiles(root);
  const a = artifactPaths(scope);
  if (rv === 'RV-01') return [a.req];
  if (rv === 'RV-02') return [a.design];
  if (rv === 'RV-03') return [a.testPlan, ...[...listFiles(root, 'src'), ...listFiles(root, 'e2e')].filter((f) => /\.(test|spec)\./.test(f) || f.startsWith('e2e/'))];
  if (rv === 'RV-05') return [...listFiles(root, 'src'), ...listFiles(root, 'e2e')];
  return [];
}

const covers = (targets, file) => Object.keys(targets).some((t) => t === file || file.startsWith(t + '/'));

/** 照合。問題の一覧を返す（空なら合格） */
export function reviewEvidenceProblems(root, scope, rv, { checkTargets = true } = {}) {
  const config = loadConfig(root);
  if (config.requireReviewEvidence === false) return [];
  const required = config.reviewPerspectives[rv] || [];
  const runs = loadRuns(root, scope);
  const activity = loadActivity(root, scope);
  const mustCover = requiredTargets(root, scope, rv);
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

/** 基盤の変更に対する相互レビューの照合（変更がなければ不要） */
export function platformReviewProblems(root, branch) {
  const b = branch ?? currentBranch(root);
  const changed = changedPlatformFiles(root);
  if (!changed.length) return [];
  const doc = platformReviewDoc(b);
  return [...reviewEvidenceProblems(root, platformScope(b), 'RV-PF'), ...reviewProblems(readText(path.join(root, doc), null), doc)];
}

/** PR 本文・状態表示用の要約 */
export function reviewRunSummary(root, scope) {
  return loadRuns(root, scope).map((r) => ({ rv: r.rv, perspective: r.perspective, agent: r.agent_id, models: (r.models || []).join(', '), at: r.at }));
}
