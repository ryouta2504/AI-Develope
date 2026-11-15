// トレーサビリティの算出: REQ → AC → DES → WP → TC → テスト結果 → コミット → レビュー指摘
import path from 'node:path';
import { readText, readJSON, git, listFiles } from './util.mjs';
import { artifactPaths, REVIEW_FINDING_ID } from './config.mjs';
import { mergeBase } from './branching.mjs';
import { parseRequirements, extractDefinitions, testIdsInCode, allIds, idType } from './ids.mjs';

export const RESULTS_FILE = '.ai-dev/.cache/test-results.json';
export const E2E_RESULTS_FILE = '.ai-dev/.cache/e2e-results.json';

export function buildTrace(root, cycleId) {
  const a = artifactPaths(cycleId);
  const reqText = readText(path.join(root, a.req), '');
  const desText = readText(path.join(root, a.design), '');
  const tpText = readText(path.join(root, a.testPlan), '');
  const { reqs, defs: reqDefs } = parseRequirements(reqText);
  const desDefs = extractDefinitions(desText, ['DES', 'WP']);
  const tcDefs = extractDefinitions(tpText, ['TC']);
  const codeTc = testIdsInCode(root);
  const results = testResults(root);
  const commits = commitRefs(root);
  const reviews = reviewRefs(root, a.dir);

  const defined = new Set([...reqDefs.keys(), ...desDefs.keys(), ...tcDefs.keys()]);
  const desFor = (id) => [...desDefs].filter(([k, d]) => idType(k) === 'DES' && d.refs.has(id)).map(([k]) => k);
  const wpFor = (desId) => [...desDefs].filter(([k, d]) => idType(k) === 'WP' && d.refs.has(desId)).map(([k]) => k);
  const tcFor = (id) => [...tcDefs].filter(([, d]) => d.refs.has(id)).map(([k]) => k);

  const rows = [];
  for (const r of reqs.values()) {
    const des = desFor(r.id);
    const wps = [...new Set(des.flatMap(wpFor))];
    const acs = r.acs.length ? r.acs : [null];
    for (const ac of acs) {
      const tcs = ac ? tcFor(ac) : tcFor(r.id);
      rows.push({
        req: r.id,
        priority: r.priority,
        ac,
        des,
        wps,
        tcs,
        results: tcs.map((t) => results.get(t) || (codeTc.has(t) ? 'unknown' : 'missing')),
        commits: [...new Set([r.id, ac, ...des, ...tcs].filter(Boolean).flatMap((id) => commits.get(id) || []))],
        reviews: [...new Set([r.id, ac, ...des, ...tcs].filter(Boolean).flatMap((id) => reviews.get(id) || []))],
      });
    }
  }
  return { reqs, reqDefs, desDefs, tcDefs, codeTc, results, rows, defined, texts: { reqText, desText, tpText } };
}

/** フェーズごとの検証。level: 'design' | 'red' | 'green' */
export function traceProblems(t, level) {
  const p = [];
  if (t.reqs.size === 0) p.push('要求（REQ-xxx）が 1 件も定義されていません');
  for (const r of t.reqs.values()) {
    if (idType(r.id) === 'REQ' && r.acs.length === 0) p.push(`${r.id}: 受入基準（AC-xxx-n）がありません`);
  }
  // 未定義 ID への参照
  const refsIn = (defs) => [...defs.values()].flatMap((d) => [...d.refs]);
  for (const id of [...refsIn(t.desDefs), ...refsIn(t.tcDefs)]) {
    if (!t.defined.has(id) && !/^RV-/.test(id)) p.push(`未定義の ID を参照しています: ${id}`);
  }
  if (level === 'requirements') return dedupe(p);

  for (const r of t.reqs.values()) {
    if (r.priority === 'Must' && t.rows.filter((x) => x.req === r.id).every((x) => x.des.length === 0)) p.push(`${r.id}（Must）に対応する設計（DES）がありません`);
  }
  if (![...t.desDefs.keys()].some((k) => idType(k) === 'WP')) p.push('設計書に作業パッケージ（WP-xx）表がありません');
  if (level === 'design') return dedupe(p);

  for (const row of t.rows) if (row.ac && row.tcs.length === 0) p.push(`${row.ac} に対応するテストケース（TC）がありません`);
  for (const tc of t.tcDefs.keys()) if (!t.codeTc.has(tc)) p.push(`${tc} はテスト計画にありますが、テストコードにありません（テスト名に [${tc}] を入れてください）`);
  for (const tc of t.codeTc.keys()) if (!t.tcDefs.has(tc)) p.push(`${tc} はテストコードにありますが、テスト計画にありません`);
  if (level === 'red') return dedupe(p);

  // テスト計画のすべての TC に「成功」の実行結果が必要（E2E も含む。結果がないものは未実行として不合格）
  for (const tc of t.tcDefs.keys()) {
    const st = t.results.get(tc);
    if (!st) p.push(`${tc} の実行結果がありません（E2E なら playwright の json レポートを .ai-dev/.cache/e2e-results.json に出力してください）`);
    else if (st !== 'passed') p.push(`${tc} が成功していません（${st}）`);
  }
  return dedupe(p);
}

const dedupe = (a) => [...new Set(a)];

/** Vitest と Playwright の JSON レポートから TC ごとの結果を取得（1 つでも失敗があれば failed） */
function testResults(root) {
  const map = new Map();
  const put = (name, status) => {
    for (const m of String(name).matchAll(/\[(TC-\d{3,})\]/g)) {
      if (map.get(m[1]) !== 'failed') map.set(m[1], status);
    }
  };
  const vitest = readJSON(path.join(root, RESULTS_FILE), null);
  for (const file of vitest?.testResults || []) {
    for (const a of file.assertionResults || []) put(a.fullName || a.title || '', a.status === 'passed' ? 'passed' : a.status);
  }
  const pw = readJSON(path.join(root, E2E_RESULTS_FILE), null);
  const walk = (suite, prefix) => {
    for (const spec of suite.specs || []) put(`${prefix} ${spec.title}`, playwrightStatus(spec));
    for (const s of suite.suites || []) walk(s, `${prefix} ${s.title || ''}`);
  };
  for (const s of pw?.suites || []) walk(s, s.title || '');
  return map;
}

/** Playwright の spec の結果。spec.ok は skipped でも true になるため、各 result の status が passed かで判定する */
function playwrightStatus(spec) {
  const results = (spec.tests || []).flatMap((t) => t.results || []);
  if (!results.length) return spec.ok ? 'skipped' : 'failed';
  if (results.every((r) => r.status === 'passed')) return 'passed';
  return results.some((r) => r.status === 'skipped') ? 'skipped' : 'failed';
}

/** main からの差分コミットの Refs: */
function commitRefs(root) {
  const map = new Map();
  const base = mergeBase(root);
  const range = base ? `${base}..HEAD` : 'HEAD';
  const log = git(root, ['log', range, '--format=%h%x00%B%x1e']) || '';
  for (const entry of log.split('\x1e')) {
    const [hash, body] = entry.trim().split('\x00');
    if (!hash || !body) continue;
    for (const id of allIds(body)) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(hash);
    }
  }
  return map;
}

/** レビュー記録で言及された ID → 指摘 ID */
function reviewRefs(root, dir) {
  const map = new Map();
  for (const f of listFiles(root, `${dir}/reviews`)) {
    for (const line of (readText(path.join(root, f), '') || '').split(/\r?\n/)) {
      const rv = line.match(REVIEW_FINDING_ID)?.[0];
      if (!rv) continue;
      const status = /対応済/.test(line) ? '済' : /保留/.test(line) ? '保留' : /却下/.test(line) ? '却下' : '未';
      for (const id of allIds(line)) {
        if (id.startsWith('RV-')) continue;
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(`${rv}(${status})`);
      }
    }
  }
  return map;
}

export function renderMatrix(t, cycleId) {
  const icon = { passed: '✅', failed: '❌', missing: '⛔', unknown: '❔', skipped: '⏭', pending: '⏳' };
  const lines = [
    `# トレーサビリティマトリクス: ${cycleId}`,
    '',
    '> このファイルは `npm run trace` で自動生成されます。手で編集しないでください。',
    '',
    '| REQ | 優先 | AC | DES | WP | TC | 結果 | コミット | レビュー指摘 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of t.rows) {
    const res = r.tcs.map((tc, i) => `${icon[r.results[i]] || '❔'}`).join(' ');
    lines.push(
      `| ${r.req} | ${r.priority} | ${r.ac || '-'} | ${r.des.join(', ') || '⛔'} | ${r.wps.join(', ') || '-'} | ${r.tcs.join(', ') || '⛔'} | ${res || '-'} | ${r.commits.slice(0, 5).join(', ') || '-'} | ${r.reviews.join(', ') || '-'} |`,
    );
  }
  lines.push('', '凡例: ✅ 成功 / ❌ 失敗 / ❔ 結果未取得 / ⛔ 欠落', '');
  return lines.join('\n');
}
