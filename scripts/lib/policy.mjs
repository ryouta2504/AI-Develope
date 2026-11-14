// 書き込み・コマンド実行の可否判定（フックはここを呼ぶだけ）
// 判定結果: { allow: boolean, reason?: string, hint?: string }
import fs from 'node:fs';
import path from 'node:path';
import { toRel, matchAny, readText, currentBranch } from './util.mjs';
import {
  HUMAN_ONLY,
  PLATFORM,
  TEST_FILES,
  CONFIG_FILES,
  PRODUCT_FILES,
  TDD_EXEMPT,
  FREE_FILES,
  artifactPaths,
  PLAN_FILE,
  BACKLOG_FILE,
  loadConfig,
} from './config.mjs';
import { deriveState, lockedTests, nextAction } from './state.mjs';
import { parseWorkPackages, SKIP_RE } from './ids.mjs';

const allow = () => ({ allow: true });
const deny = (reason, hint) => ({ allow: false, reason, hint });

/** パスの分類 */
export function classify(rel, cycleId) {
  if (matchAny(rel, HUMAN_ONLY)) return 'human_only';
  if (matchAny(rel, PLATFORM)) return 'platform';
  if (rel === 'package.json') return 'package_json';
  if (rel === PLAN_FILE) return 'plan';
  if (rel === BACKLOG_FILE) return 'backlog';
  if (matchAny(rel, FREE_FILES)) return 'free';
  if (rel.startsWith('docs/cycles/')) {
    if (!cycleId || !rel.startsWith(`docs/cycles/${cycleId}/`)) return 'other_cycle';
    const a = artifactPaths(cycleId);
    const map = {
      [a.req]: 'req',
      [a.rvReq]: 'rv_req',
      [a.design]: 'design',
      [a.rvDesign]: 'rv_design',
      [a.testPlan]: 'test_plan',
      [a.rvTest]: 'rv_test',
      [a.rvCode]: 'rv_code',
      [a.trace]: 'generated',
      [a.retro]: 'cycle_free',
    };
    if (map[rel]) return map[rel];
    if (rel.startsWith(`${a.dir}/tasks/`)) return 'cycle_free';
    return 'cycle_other';
  }
  if (matchAny(rel, TEST_FILES)) return 'test';
  if (matchAny(rel, CONFIG_FILES)) return 'config';
  if (matchAny(rel, PRODUCT_FILES)) return 'product';
  return 'unclassified';
}

/** フェーズごとに書き込めるファイル種別 */
const PHASE_WRITABLE = {
  planning: ['plan', 'backlog'],
  idle: ['plan', 'backlog'],
  requirements: ['req', 'rv_req', 'backlog'],
  design: ['design', 'rv_design', 'backlog'],
  test_design: ['test_plan', 'rv_test', 'test', 'config', 'backlog'],
  implementation: ['product', 'test', 'rv_code', 'backlog'],
  ai_review: ['product', 'test', 'rv_code', 'backlog'],
  final_review: ['backlog'],
  done: ['backlog'],
};

/** 役割（agent_type）ごとに書き込めるファイル種別。main = メインセッション（PM） */
const ROLE_WRITABLE = {
  main: ['plan', 'backlog', 'cycle_free', 'free'],
  requirements: ['req'],
  architect: ['design'],
  'test-designer': ['test_plan', 'test', 'config'],
  implementer: ['product', 'test'],
  'review-aggregator': ['rv_req', 'rv_design', 'rv_test', 'rv_code'],
  reviewer: [],
  explorer: [],
};

const ALWAYS_OK_KINDS = ['free', 'cycle_free', 'unclassified'];

const KIND_LABEL = {
  req: '要求定義',
  rv_req: '要求レビュー記録',
  design: '設計書',
  rv_design: '設計レビュー記録',
  test_plan: 'テスト計画',
  rv_test: 'テストレビュー記録',
  test: 'テストコード',
  config: 'テスト・ビルド設定',
  product: '製品コード',
  rv_code: 'コードレビュー記録',
  plan: '開発計画',
  backlog: 'バックログ',
};

/**
 * ファイル書き込みの判定
 * @param {object} ctx
 *  root, absPath, agentType (undefined = メイン), newText (書き込み後の内容が分かる場合), addedText (追加される文字列)
 *  state（省略時は算出）, branch（省略時は git から取得）
 */
export function checkWrite(ctx) {
  const { root } = ctx;
  const rel = toRel(root, ctx.absPath);
  if (rel === null) return allow(); // プロジェクト外
  if (rel === '') return deny('プロジェクトルートそのものは操作できません');
  const state = ctx.state || deriveState(root);
  const config = ctx.config || loadConfig(root);
  const role = ctx.agentType || 'main';
  const kind = classify(rel, state.cycle);
  const status = `[${state.cycle || '-'} phase=${state.phase}]`;

  // 1. 人間だけの領域
  if (kind === 'human_only') {
    return deny(`${rel} はゲートの状態・承認記録です。AI は変更できません。`, '状態の変更は npm run gate / 人間の npm run approve で行います。');
  }
  // 2. 基盤そのもの
  if (kind === 'platform') {
    if (state.maintenance && role === 'main') return allow();
    return deny(`${rel} は開発基盤（ゲートの仕組み）のファイルです。`, '変更が必要なら、人間に `npm run maintenance -- on` を依頼してください。');
  }
  if (kind === 'package_json') {
    if (state.maintenance && role === 'main') return allow();
    if (ctx.newText !== undefined) {
      const before = safeJson(readText(path.join(root, 'package.json'), '{}'));
      const after = safeJson(ctx.newText);
      if (!after) return deny('package.json が正しい JSON ではありません。');
      if (JSON.stringify(before?.scripts || {}) !== JSON.stringify(after.scripts || {}))
        return deny('package.json の scripts はゲートが使うため変更できません。', '依存パッケージの追加は npm install で行ってください。');
      // 依存パッケージの追加は test-designer / implementer だけ（PM は委任する）
      if (['test-designer', 'implementer'].includes(role) || (role === 'main' && !config.enforcePmNoCode)) return allow();
      return deny(`${role === 'main' ? 'PM（メインセッション）' : role} は package.json を変更できません。`, '依存パッケージの追加は test-designer / implementer に委任してください。');
    }
    return deny('package.json は直接書き換えられません。', '依存パッケージの追加は npm install で行ってください。');
  }
  if (kind === 'other_cycle') return deny(`${rel} は現在のサイクル以外の記録です。過去の記録は変更できません。`);
  if (kind === 'generated') return deny(`${rel} は自動生成ファイルです。`, '`npm run trace` で再生成してください。');
  if (kind === 'cycle_other') return deny(`${rel} はサイクルの成果物として定義されていない場所です。`, 'tasks/ か所定の成果物ファイルを使ってください。');

  // 3. 役割
  if (!ALWAYS_OK_KINDS.includes(kind)) {
    const r = roleCheck(role, kind, rel, config);
    if (r) return r;
  } else if (kind === 'unclassified' && config.enforceRoles && role !== 'main' && !ROLE_WRITABLE[role]) {
    return deny(`役割の定義されていないエージェント（${role}）はファイルを書き込めません。`);
  }

  // 4. フェーズ
  if (!ALWAYS_OK_KINDS.includes(kind)) {
    const writable = PHASE_WRITABLE[state.phase] || [];
    if (!writable.includes(kind)) {
      return deny(`${status} ${KIND_LABEL[kind] || kind}（${rel}）は現在のフェーズでは編集できません。`, `次の手順: ${nextAction(state)}`);
    }
  }

  // 5. WP（並列実装）の所有パス
  if (['product', 'test'].includes(kind)) {
    const branch = ctx.branch ?? currentBranch(root);
    const m = branch.match(/^wp\/([^/]+)\/(WP-\d{2,})/);
    if (m) {
      const wps = parseWorkPackages(readText(path.join(root, artifactPaths(state.cycle).design), ''));
      const owned = wps.get(m[2]) || [];
      if (!matchAny(rel, owned))
        return deny(`${rel} は ${m[2]} の所有パス外です（所有: ${owned.join(', ') || 'なし'}）。`, '担当外の変更が必要なら、完了報告票の「懸念」に書いて PM に返してください。');
    }
  }

  // 6. ロック済みテスト
  if (['test', 'config'].includes(kind) && ['implementation', 'ai_review'].includes(state.phase)) {
    if (lockedTests(root, state.cycle).includes(rel))
      return deny(`${rel} は RED 確定時にロックされたテストです。テストを変えて通すことはできません。`, 'テストの誤りなら PM 経由で人間に `npm run reopen -- RED "理由"` を依頼してください。');
  }

  // 7. TDD: 製品コードには対応するテストが必要
  if (kind === 'product' && /\.[cm]?[jt]sx?$/.test(rel) && !matchAny(rel, TDD_EXEMPT)) {
    if (!hasTestFor(root, rel))
      return deny(`${rel} に対応するテストがありません（TDD: テストが先）。`, `先に ${rel.replace(/\.([cm]?[jt]sx?)$/, '.test.$1')} などのテストが必要です。`);
  }

  // 8. テストのスキップ・限定実行の禁止
  if (kind === 'test') {
    const text = ctx.addedText ?? ctx.newText;
    if (text && SKIP_RE.test(text)) return deny('テストに .skip / .only / xit などは使えません。', 'すべてのテストを実行対象にしてください。');
  }

  return allow();
}

function roleCheck(role, kind, rel, config) {
  if (role === 'main') {
    if (!config.enforcePmNoCode) return null;
    if (ROLE_WRITABLE.main.includes(kind)) return null;
    return deny(`PM（メインセッション）は ${KIND_LABEL[kind] || kind}（${rel}）を直接編集できません。`, 'タスク票を作り、担当のサブエージェントに委任してください。');
  }
  if (!config.enforceRoles) return null;
  const allowed = ROLE_WRITABLE[role];
  if (!allowed) return deny(`役割の定義されていないエージェント（${role}）はファイルを書き込めません。`, '.claude/agents/ に定義された担当エージェントを使ってください。');
  if (!allowed.includes(kind)) return deny(`${role} の担当外です: ${KIND_LABEL[kind] || kind}（${rel}）。`, '担当外の作業は完了報告票に書いて PM に返してください（1 タスク 1 目的）。');
  return null;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function hasTestFor(root, rel) {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel).replace(/\.[cm]?[jt]sx?$/, '');
  const exts = ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs'];
  const candidates = [];
  for (const k of ['test', 'spec']) {
    for (const e of exts) {
      candidates.push(`${dir}/${base}.${k}.${e}`);
      candidates.push(`${dir}/__tests__/${base}.${k}.${e}`);
    }
  }
  return candidates.some((c) => fs.existsSync(path.join(root, c)));
}

// ───────────────────────── Bash / PowerShell ─────────────────────────

const HUMAN_SCRIPTS = /(?:\bnpm(?:\.cmd)?\s+(?:run(?:-script)?\s+)?|\bnode\s+\S*scripts[\\/]|scripts[\\/])(approve|reject|reopen|maintenance)\b/i;
const SAFE_AIDEV_SCRIPTS = /^\s*(?:npm(?:\.cmd)?\s+run\s+(?:gate|status|trace|cycle:new|cycle:close|wp:start|wp:merge|pr:create|test:platform)\b|node\s+(?:\.\/)?scripts[\\/](?:gate|status|trace|cycle|wp|pr)\.mjs\b)/i;
const WRITE_CMDS = new Set(['rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'ln', 'chmod', 'truncate', 'install', 'unlink', 'shred', 'rsync']);
const PS_WRITE_CMDS = /^(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|sc|ac|ni|ri|del|erase|rd|copy|move|ren|cpi|mi|rni)$/i;
const INLINE_WRITE = /writeFile|appendFile|rmSync|unlinkSync|rmdirSync|renameSync|copyFile|createWriteStream|fs\.write|open\([^)]*['"][wa]['"]|WriteAllText|Set-Content|Out-File|shutil\.|os\.remove/i;
/** 中身ごと消されると困るディレクトリ */
const GUARDED_DIRS = ['.ai-dev', '.claude', 'scripts', '.githooks', '.github', 'tests', 'docs', 'src', 'e2e', '.git'];

/** コマンドを ; && || | 改行で分割（引用符内は無視） */
export function splitSegments(command) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === ';' || c === '\n' || (c === '|' && command[i + 1] !== '|') || (c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      if (cur.trim()) segs.push(cur.trim());
      cur = '';
      if ((c === '&' || c === '|') && command[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs;
}

export function tokenize(seg) {
  const toks = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) toks.push(m[1] ?? m[2] ?? m[3]);
  return toks;
}

/** git の現在ブランチを取得する関数（テストで差し替え可能） */
export function checkBash(ctx) {
  const { root, command } = ctx;
  const state = ctx.state || deriveState(root);
  const branch = ctx.branch ?? currentBranch(root);
  const cwd = ctx.cwd || root;
  const role = ctx.agentType || 'main';

  if (HUMAN_SCRIPTS.test(command)) return deny('承認・差し戻し・メンテナンスの操作は人間だけが行えます。', '人間に依頼してください（ターミナルで npm run approve など）。');
  if (/--no-verify\b/.test(command)) return deny('--no-verify（フックの無効化）は使えません。');
  if (/core\.hooksPath/i.test(command) && !/^\s*npm run setup\b/.test(command)) return deny('git フックの設定は変更できません。');

  for (const seg of splitSegments(command)) {
    const toks = tokenize(seg);
    while (toks.length && /^[A-Z_][A-Z0-9_]*=/.test(toks[0])) toks.shift(); // VAR=x cmd
    if (toks[0] === 'sudo') toks.shift();
    if (toks.length === 0) continue;
    const cmd = path.basename(toks[0]).toLowerCase().replace(/\.(exe|cmd)$/, '');

    // .ai-dev への書き込みは決められたスクリプト経由のみ
    if (/\.ai-dev/.test(seg) && !SAFE_AIDEV_SCRIPTS.test(seg) && isWritingSegment(seg, cmd, toks)) {
      return deny('.ai-dev（ゲートの状態）はスクリプト経由でのみ更新できます。', 'npm run gate / npm run status を使ってください。');
    }

    if (cmd === 'git') {
      const r = checkGit(toks.slice(1), branch, state);
      if (r) return r;
      // checkout -- / restore / rm / mv は下の書き込み先チェックへ進む
    }
    if (cmd === 'gh') {
      const r = checkGh(toks.slice(1));
      if (r) return r;
      continue;
    }
    if (cmd === 'npm' && /\bnpm\s+(pkg\s+(set|delete)|set-script)\b/.test(seg) && !state.maintenance) {
      return deny('package.json の scripts / 設定は変更できません。');
    }
    if (['node', 'python', 'python3', 'py', 'deno', 'bun', 'powershell', 'pwsh'].includes(cmd) && /\s(-e|-c|--eval|-Command|-c)\s/i.test(' ' + seg + ' ')) {
      if (INLINE_WRITE.test(seg)) {
        const mentioned = mentionedPaths(seg, root, cwd);
        for (const p of mentioned) {
          const r = checkWrite({ root, absPath: p, agentType: ctx.agentType, state, branch });
          if (!r.allow) return deny(`インラインスクリプトから保護対象へ書き込もうとしています: ${r.reason}`, r.hint);
        }
      }
    }
    if (cmd === 'patch') {
      return deny('patch による一括変更は使えません。', 'Edit / Write ツールで変更してください。');
    }

    const targets = writeTargets(seg, cmd, toks);
    for (const t of targets) {
      if (/^(\/dev\/null|nul|\$null|&\d)$/i.test(t)) continue;
      const abs = path.resolve(cwd, t.replace(/[*?].*$/, '') || '.');
      const rel = toRel(root, abs);
      if (rel === null) continue;
      // ディレクトリごとの削除・移動
      if (['rm', 'rmdir', 'mv', 'remove-item', 'ri', 'del', 'rd', 'move-item', 'mi'].includes(cmd) || /[*?]/.test(t)) {
        const isAncestorOfGuarded = rel === '' || GUARDED_DIRS.some((d) => rel === d || d.startsWith(rel + '/'));
        const isDirInsideGuarded = (isDir(abs) || /[*?]/.test(t)) && GUARDED_DIRS.some((d) => rel.startsWith(d + '/'));
        if (isAncestorOfGuarded || isDirInsideGuarded)
          return deny(`${rel || '(ルート)'} をディレクトリごと（またはワイルドカードで）削除・移動することはできません。`, '個別のファイルを Edit / Write で変更してください。');
      }
      const r = checkWrite({ root, absPath: abs, agentType: ctx.agentType, state, branch });
      if (!r.allow) return deny(`コマンドで書き込もうとしています: ${r.reason}`, r.hint);
    }
  }
  void role;
  return allow();
}

function isDir(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function isWritingSegment(seg, cmd, toks) {
  return writeTargets(seg, cmd, toks).length > 0 || INLINE_WRITE.test(seg) || /\bsed\b.*\s-i/.test(seg) || ['git'].includes(cmd) && /\b(checkout|restore|rm|mv|clean)\b/.test(seg);
}

/** セグメントから書き込み先のパスを抽出する */
export function writeTargets(seg, cmd, toks) {
  const targets = [];
  // リダイレクト（引用符の中の > は無視する）
  const quoted = [];
  const bare = seg.replace(/"[^"]*"|'[^']*'/g, (q) => `\u0000${quoted.push(q.slice(1, -1)) - 1}\u0000`);
  for (const m of bare.matchAll(/(?:^|[^<>&0-9=-])(?:\d|&)?>>?\s*([^\s;|&<>]+)/g)) {
    targets.push(m[1].replace(/\u0000(\d+)\u0000/g, (_, n) => quoted[Number(n)]));
  }
  const args = toks.slice(1);
  const positional = args.filter((a) => !a.startsWith('-'));
  if (WRITE_CMDS.has(cmd)) targets.push(...positional);
  if (cmd === 'sed' && args.some((a) => /^-i/.test(a) || a === '--in-place')) {
    const hasE = args.includes('-e');
    targets.push(...(hasE ? positional : positional.slice(1)));
  }
  if (cmd === 'dd') for (const a of args) if (a.startsWith('of=')) targets.push(a.slice(3));
  if (PS_WRITE_CMDS.test(cmd)) {
    for (let i = 0; i < args.length; i++) {
      if (/^-(path|literalpath|destination|filepath)$/i.test(args[i]) && args[i + 1]) targets.push(args[++i]);
      else if (/^-(value|encoding|itemtype|type|name)$/i.test(args[i])) i++;
      else if (!args[i].startsWith('-')) targets.push(args[i]);
    }
  }
  if (cmd === 'git') {
    const sub = args.find((a) => !a.startsWith('-'));
    const rest = args.slice(args.indexOf(sub) + 1);
    if (sub === 'checkout' && rest.includes('--')) targets.push(...rest.slice(rest.indexOf('--') + 1));
    if (sub === 'restore' || sub === 'rm' || sub === 'mv') targets.push(...rest.filter((a) => !a.startsWith('-') && a !== '--'));
  }
  return targets.filter(Boolean);
}

function mentionedPaths(seg, root, cwd) {
  const out = new Set();
  for (const m of seg.matchAll(/['"`]([^'"`]*?(?:\.ai-dev|\.claude|scripts|\.githooks|\.github|docs|src|e2e|tests|package\.json|CLAUDE\.md)[^'"`]*)['"`]/g)) {
    out.add(path.resolve(cwd, m[1]));
  }
  void root;
  return [...out];
}

const ALLOWED_PUSH = [/^cycle\//, /^wp\//, /^plan\//];

function checkGit(args, branch, state) {
  // グローバルオプション（-C path / -c k=v）を飛ばす
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C' || args[i] === '-c') i += 2;
    else i += 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const has = (...f) => rest.some((a) => f.includes(a) || f.some((x) => x.startsWith('--') && a.startsWith(x + '=')));
  const onMain = ['main', 'master'].includes(branch);

  switch (sub) {
    case 'push': {
      if (has('--force', '-f', '--force-with-lease', '--force-if-includes', '--mirror', '--delete', '-d', '--all', '--prune'))
        return deny('force push・ブランチ削除・一括 push はできません。');
      const positional = rest.filter((a) => !a.startsWith('-'));
      const refspecs = positional.slice(1);
      const dests = refspecs.length ? refspecs.map((r) => (r.startsWith('+') ? null : r.includes(':') ? r.split(':')[1] : r === 'HEAD' ? branch : r)) : [branch];
      for (const d of dests) {
        if (!d) return deny('強制更新（+refspec）はできません。');
        const name = d.replace(/^refs\/heads\//, '');
        const ok = ALLOWED_PUSH.some((re) => re.test(name)) || (state.maintenance && /^feature\//.test(name));
        if (!ok) return deny(`${name} へは push できません。AI が push できるのは cycle/* と wp/* と plan/* だけです。`, 'main への反映は PR 経由で、人間がマージします。');
      }
      return null;
    }
    case 'commit':
      if (onMain) return deny('main ブランチへ直接コミットすることはできません。', 'cycle/* ブランチで作業してください（npm run cycle:new）。');
      if (has('--amend')) return deny('--amend（履歴の書き換え）はできません。新しいコミットを作ってください。');
      if (rest.includes('-n')) return deny('-n（フックの無効化）は使えません。');
      return null;
    case 'merge':
      if (onMain) return deny('main へのマージは PR 経由で人間が行います。');
      return null;
    case 'apply':
    case 'am':
      return deny('patch による一括変更は使えません。', 'Edit / Write ツールで変更してください。');
    case 'rebase':
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
    case 'update-ref':
      return deny(`git ${sub}（履歴の書き換え）はできません。`);
    case 'reset':
      if (has('--hard', '--merge', '--keep')) return deny('git reset --hard はできません。');
      return null;
    case 'branch':
      if (has('-d', '-D', '--delete', '-f', '--force', '-m', '-M', '--move')) return deny('ブランチの削除・強制変更・名前変更はできません。');
      return null;
    case 'tag':
      return deny('タグの作成・削除は人間が行います。');
    case 'clean':
      if (has('-f', '--force') || rest.some((a) => /^-[a-z]*f/.test(a))) return deny('git clean -f（未追跡ファイルの削除）はできません。');
      return null;
    case 'config':
      if (rest.some((a) => /hooksPath|user\.(name|email)/i.test(a)) && rest.filter((a) => !a.startsWith('-')).length > 1) return deny('git の設定（フック・ユーザー情報）は変更できません。');
      return null;
    case 'worktree':
      if (rest[0] === 'remove' || rest[0] === 'prune') return deny('worktree の削除は npm run wp:merge で行います。');
      return null;
    default:
      return null;
  }
}

function checkGh(args) {
  const [a, b] = args;
  if (a === 'pr' && b === 'merge') return deny('PR のマージは人間だけが行えます。');
  if (a === 'pr' && b === 'review' && args.some((x) => ['--approve', '-a'].includes(x))) return deny('PR の承認は人間だけが行えます。');
  if (a === 'repo' && ['delete', 'edit', 'rename', 'archive'].includes(b)) return deny('リポジトリ設定の変更はできません。');
  if (['secret', 'variable', 'ruleset', 'auth'].includes(a) && !(a === 'auth' && b === 'status')) return deny(`gh ${a} は人間が操作します。`);
  if (a === 'api') {
    const joined = args.join(' ');
    if (/(-X|--method)\s*=?\s*(PUT|PATCH|DELETE)/i.test(joined) || /\/(merge|protection|rulesets|collaborators)\b/.test(joined))
      return deny('gh api によるリポジトリ変更はできません。');
  }
  return null;
}
