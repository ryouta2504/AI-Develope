// ID の抽出（トレーサビリティ）とレビュー記録の解析
//
// ルール: ある ID が「その行で最初に現れる」行を、その ID の定義行とみなす。
// 定義行に一緒に書かれた他の ID は「参照（紐づけ先）」として扱う。
//   例: | DES-003 | 一覧表示 | REQ-001, REQ-004 | ... |  → DES-003 は REQ-001, REQ-004 に紐づく
//   例: ### REQ-001: タスクを追加できる                    → REQ-001 の定義
import path from 'node:path';
import { readText, listFiles } from './util.mjs';
import { isTestFile, REVIEW_FINDING_ID } from './config.mjs';

export const ID_RE = /\b(REQ-\d{3,}|NFR-\d{3,}|AC-\d{3,}-\d+|DES-\d{3,}|WP-\d{2,}|TC-\d{3,}|RV-(?:\d{2}|PF)-\d{3,})\b/g;

export const idType = (id) => id.replace(/-.*/, '');

/** 文書から定義と参照を抽出する: Map<id, {line, refs:Set, text}> */
export function extractDefinitions(text, types) {
  const defs = new Map();
  if (!text) return defs;
  let currentParent = null; // 見出しの REQ の下にある AC を親に紐づけるため
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const ids = [...line.matchAll(ID_RE)].map((m) => m[1]);
    if (ids.length === 0) continue;
    const first = ids[0];
    const isDefLine = /^\s*(#{1,6}\s|\|\s*|[-*]\s+)/.test(line) && line.indexOf(first) <= line.search(/\S/) + 8;
    if (!isDefLine || !types.includes(idType(first))) continue;
    if (/^#{1,6}\s/.test(line) && ['REQ', 'NFR'].includes(idType(first))) currentParent = first;
    if (defs.has(first)) {
      for (const r of ids.slice(1)) defs.get(first).refs.add(r);
      continue;
    }
    const refs = new Set(ids.slice(1));
    if (idType(first) === 'AC' && currentParent) refs.add(currentParent);
    defs.set(first, { line: i + 1, refs, text: line.trim() });
  }
  return defs;
}

/** 文書内の全 ID 出現 */
export function allIds(text) {
  return new Set([...(text || '').matchAll(ID_RE)].map((m) => m[1]));
}

/** 要求定義から REQ / AC / NFR と優先度を取得 */
export function parseRequirements(text) {
  const defs = extractDefinitions(text, ['REQ', 'NFR', 'AC']);
  const reqs = new Map();
  const lines = (text || '').split(/\r?\n/);
  for (const [id, d] of defs) {
    if (idType(id) === 'AC') continue;
    // 見出し形式なら次の見出しまで、表形式ならその行だけから優先度を探す
    const scan = [d.text];
    if (d.text.startsWith('#')) {
      for (let i = d.line; i < lines.length && !/^#{1,6}\s/.test(lines[i]); i++) scan.push(lines[i]);
    }
    // 「優先度: Must」の明示を全行から先に探し、なければ単語（Must / Should / Could）を探す（見出しの英単語に引きずられない）
    let priority = null;
    for (const re of [/優先度\s*[:：]\s*(Must|Should|Could)/i, /\b(Must|Should|Could)\b/i]) {
      for (const l of scan) {
        const m = l.match(re);
        if (m) {
          priority = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
          break;
        }
      }
      if (priority) break;
    }
    reqs.set(id, { id, priority: priority || 'Must', acs: [] });
  }
  for (const [id, d] of defs) {
    if (idType(id) !== 'AC') continue;
    const parentId = id.replace(/^AC-(\d+)-\d+$/, 'REQ-$1');
    const parent = reqs.get(parentId) || [...d.refs].map((r) => reqs.get(r)).find(Boolean);
    if (parent) parent.acs.push(id);
  }
  return { reqs, defs };
}

/** 設計書の WP 表から所有パスを取得: Map<WP-xx, string[]> */
export function parseWorkPackages(text) {
  const result = new Map();
  if (!text) return result;
  const lines = text.split(/\r?\n/);
  let header = null;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!header) {
      if (cells.some((c) => /所有パス|owned/i.test(c))) header = cells;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const wp = cells[0]?.match(/WP-\d{2,}/)?.[0];
    if (!wp) continue;
    const col = header.findIndex((c) => /所有パス|owned/i.test(c));
    const globs = (cells[col] || '')
      .split(/<br\s*\/?>|,|、|\s+/)
      .map((s) => s.replace(/`/g, '').trim())
      .filter(Boolean);
    result.set(wp, globs);
  }
  return result;
}

const SEVERITIES = ['Critical', 'Major', 'Minor'];
const RESOLVED = ['対応済', '保留', '却下'];

/** レビュー記録の指摘表を解析する */
export function parseReview(text) {
  const findings = [];
  if (!text) return { exists: false, hasTable: false, findings };
  let hasTable = false;
  let header = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!header) {
      // 「状態」列がない表も指摘表として扱う（状態が空 = 未解決として判定される）
      if (cells.some((c) => /重大度/.test(c))) {
        header = cells;
        hasTable = true;
      }
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const get = (re) => cells[header.findIndex((c) => re.test(c))] ?? '';
    const id = get(/指摘/).match(REVIEW_FINDING_ID)?.[0] || get(/指摘/);
    const severity = SEVERITIES.find((s) => get(/重大度/).toLowerCase().includes(s.toLowerCase())) || get(/重大度/);
    const status = get(/状態/);
    const action = get(/対応/);
    findings.push({ id, severity, status, action, row: line.trim() });
  }
  return { exists: true, hasTable, findings };
}

/** レビュー記録のゲート判定: Critical は対応済か理由付き却下、Major は理由付きで解決済み */
export function reviewProblems(text, label) {
  const { exists, findings } = parseReview(text);
  if (!exists) return [`${label} がありません`];
  if (!parseReview(text).hasTable && !/^\s*[-*]?\s*指摘なし\s*$/m.test(text)) return [`${label} に指摘表（重大度の列を持つ表）がありません。指摘がない場合は「指摘なし」と書いてください`];
  const problems = [];
  const hasReason = (f) => f.action && f.action !== '-' && f.action.length >= 2;
  for (const f of findings) {
    if (!SEVERITIES.includes(f.severity)) {
      problems.push(`${f.id}: 重大度「${f.severity || '空'}」は ${SEVERITIES.join(' / ')} のいずれかにしてください`);
      continue;
    }
    const resolved = RESOLVED.find((r) => f.status.includes(r));
    if (f.severity === 'Critical') {
      if (!(resolved === '対応済' || (resolved === '却下' && hasReason(f)))) problems.push(`${f.id}: Critical が未解決（状態: ${f.status || '空'}）`);
    } else if (f.severity === 'Major') {
      if (!resolved || ((resolved === '保留' || resolved === '却下') && !hasReason(f)))
        problems.push(`${f.id}: Major が未解決または理由なし（状態: ${f.status || '空'}）`);
    }
  }
  return problems;
}

/** テストコード内の TC ID → ファイル */
export function testIdsInCode(root) {
  const map = new Map();
  const files = [...listFiles(root, 'src'), ...listFiles(root, 'e2e')].filter(isTestFile);
  for (const f of files) {
    const text = readText(path.join(root, f), '');
    for (const m of text.matchAll(/\[(TC-\d{3,})\]/g)) {
      if (!map.has(m[1])) map.set(m[1], []);
      if (!map.get(m[1]).includes(f)) map.get(m[1]).push(f);
    }
  }
  return map;
}

/** テストに .skip / .only などがないか */
export const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|only|todo|fixme|fails|skipIf|runIf)\b|\b(?:it|test|describe)\.(?:concurrent|sequential)\.(?:skip|only|todo)\b|\bx(?:it|describe|test)\s*\(|\bf(?:it|describe)\s*\(/;
