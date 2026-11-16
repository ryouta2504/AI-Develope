// 書き込み・コマンド実行の可否判定（フックはここを呼ぶだけ）
// 判定結果: { allow: boolean, reason?: string, hint?: string }
//
// 既知の限界: 任意のコードを実行できる以上（npm test で製品コードが動くなど）、実行されたプログラムによる
// 書き込みまでは止められない。最終的な防衛線は CI（ハッシュ・承認・テストの再検証）と人間の PR レビュー。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toRel, matchAny, readText, currentBranch, canonicalPath, hasAltStream, git } from './util.mjs';
import {
  HUMAN_ONLY,
  PLATFORM,
  TEST_FILES,
  CONFIG_FILES,
  PRODUCT_FILES,
  TDD_EXEMPT,
  FREE_FILES,
  PLATFORM_REVIEW_DIR,
  SCRIPT_EXT,
  artifactPaths,
  PLAN_FILE,
  IMPROVEMENTS_FILE,
  DEBT_FILE,
  loadConfig,
} from './config.mjs';
import { deriveState, lockedTests, nextAction } from './state.mjs';
import { parseWorkPackages, SKIP_RE } from './ids.mjs';
import { loadBranching, protectedBranches } from './branching.mjs';

const allow = () => ({ allow: true });
const deny = (reason, hint) => ({ allow: false, reason, hint });

/** パスの分類 */
export function classify(rel, cycleId) {
  if (matchAny(rel, HUMAN_ONLY)) return 'human_only';
  if (matchAny(rel, PLATFORM)) return 'platform';
  if (rel === 'package.json') return 'package_json';
  if (rel === PLAN_FILE) return 'plan';
  if (rel === IMPROVEMENTS_FILE) return 'improvements';
  if (rel === DEBT_FILE) return 'debt';
  if (rel.startsWith(PLATFORM_REVIEW_DIR + '/')) return 'rv_platform';
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
  if (matchAny(rel, BUILD_OUTPUT)) return 'build_output';
  if (matchAny(rel, TEST_FILES)) return 'test';
  if (matchAny(rel, CONFIG_FILES)) return 'config';
  if (matchAny(rel, PRODUCT_FILES)) {
    // テスト不要の雛形（main.tsx・index.html・CSS・型定義など）は test_design から置ける
    if (rel === 'index.html' || rel.startsWith('public/') || matchAny(rel, TDD_EXEMPT)) return 'scaffold';
    return 'product';
  }
  return 'unclassified';
}

/** 依存パッケージ・ビルド・テストの出力（成果物ではなく、いつでも作り直せるもの） */
const BUILD_OUTPUT = ['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', '.vite'].flatMap((d) => [d, `${d}/**`]).concat('package-lock.json');

/** フェーズごとに書き込めるファイル種別（フェーズに関係しない種別は ROLE_WRITABLE だけで判定） */
export const PHASE_WRITABLE = {
  planning: ['plan'],
  idle: ['plan'],
  requirements: ['req', 'rv_req'],
  design: ['design', 'rv_design'],
  test_design: ['test_plan', 'rv_test', 'test', 'config', 'scaffold'],
  implementation: ['product', 'scaffold', 'test', 'rv_code'],
  ai_review: ['product', 'scaffold', 'test', 'rv_code'],
  final_review: [],
  done: ['plan'],
};
const PHASE_FREE_KINDS = ['free', 'cycle_free', 'improvements', 'debt', 'rv_platform', 'unclassified'];

/** 役割（agent_type）ごとに書き込めるファイル種別。main = メインセッション（PM） */
export const ROLE_WRITABLE = {
  main: ['plan', 'improvements', 'debt', 'cycle_free', 'free', 'rv_platform'],
  requirements: ['req'],
  architect: ['design'],
  'test-designer': ['test_plan', 'test', 'config', 'scaffold'],
  implementer: ['product', 'scaffold', 'test'],
  'review-aggregator': ['rv_req', 'rv_design', 'rv_test', 'rv_code', 'rv_platform'],
  reviewer: [],
  explorer: [],
};

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
  scaffold: '雛形（テスト不要の製品ファイル）',
  rv_code: 'コードレビュー記録',
  rv_platform: 'テンプレートのレビュー記録',
  plan: '開発計画',
  improvements: '改善候補',
  debt: '技術的負債の台帳',
  free: 'メモ',
  cycle_free: 'タスク票・振り返り',
  unclassified: '未分類のファイル',
};

/** プロジェクト外で書き込んでよい場所（OS の一時ディレクトリだけ） */
function outsideAllowed(abs) {
  const tmp = canonicalPath(os.tmpdir());
  const rel = path.relative(tmp, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * ファイル書き込みの判定
 * @param {object} ctx
 *  root, absPath, agentType (undefined = メイン), newText (書き込み後の内容が分かる場合), addedText (追加される文字列)
 *  state（省略時は算出）, branch（省略時は git から取得）
 */
export function checkWrite(ctx) {
  if (hasAltStream(ctx.absPath)) return deny('代替データストリーム（パスの「:」）への書き込みはできません。');
  const root = canonicalPath(ctx.root);
  const abs = canonicalPath(ctx.absPath);
  const rel = toRel(root, abs);
  if (rel === null) {
    if (outsideAllowed(abs)) return allow();
    return deny(`プロジェクトの外（${abs}）には書き込めません。`, '一時ファイルは OS の一時ディレクトリを使ってください。ユーザー設定（~/.claude など）は人間が変更します。');
  }
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
  // 2. テンプレートそのもの
  if (kind === 'platform') {
    if (state.maintenance && role === 'main') return allow();
    return deny(`${rel} はテンプレート（ゲートの仕組み・その基準となる文書・ツール設定）のファイルです。`, '変更が必要なら、人間に `npm run maintenance -- on` を依頼してください。');
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
  // 決められた場所（製品・テスト・設定・雛形）以外に実行可能なスクリプトを置くと、ガードを迂回するプログラムを実行できてしまう。
  // 自由に書ける場所（docs/memo・tasks など）と、依存・ビルドの出力（node_modules など。post-edit が node_modules/.bin を実行する）も含む
  if (['unclassified', 'free', 'cycle_free', 'rv_platform', 'build_output'].includes(kind) && SCRIPT_EXT.test(rel)) {
    return deny(`${rel}: 決められた場所（src/・e2e/ など）以外に実行可能なスクリプトは置けません。`, '必要なツールはテンプレートの変更として人間に相談してください。');
  }

  if (kind === 'build_output') return allow();

  // 3. 役割
  const r = roleCheck(role, kind, rel, config);
  if (r) return r;

  // 4. フェーズ
  if (!PHASE_FREE_KINDS.includes(kind)) {
    const writable = PHASE_WRITABLE[state.phase] || [];
    if (!writable.includes(kind)) {
      return deny(`${status} ${KIND_LABEL[kind] || kind}（${rel}）は現在のフェーズでは編集できません。`, `次の手順: ${nextAction(state)}`);
    }
  }

  // 5. WP（並列実装）の所有パス
  if (['product', 'scaffold', 'test'].includes(kind)) {
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

  // 7. TDD: 製品コードには対応するテストが必要。テスト不要の雛形は中身も確認する
  if (kind === 'product' && /\.[cm]?[jt]sx?$/.test(rel)) {
    if (!hasTestFor(root, rel))
      return deny(`${rel} に対応するテストがありません（TDD: テストが先）。`, `先に ${rel.replace(/\.([cm]?[jt]sx?)$/, '.test.$1')} などのテストが必要です。`);
  }
  if (kind === 'scaffold' && ctx.newText !== undefined) {
    const p = scaffoldContentProblem(rel, ctx.newText);
    if (p) return deny(p, 'ロジックを書くなら、テストのある製品ファイルに書いてください（TDD）。');
  }

  // 8. テストの中身: スキップ・限定実行の禁止、アサーションの必須化
  if (kind === 'test') {
    const text = ctx.addedText ?? ctx.newText;
    if (text && SKIP_RE.test(text)) return deny('テストに .skip / .only / xit などは使えません。', 'すべてのテストを実行対象にしてください。');
    if (ctx.newText !== undefined && /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) && !/\bexpect\s*\(|\bassert\b|\.toHave|\.toBe/.test(ctx.newText))
      return deny(`${rel} にアサーション（expect / assert）がありません。何も検証しないテストは書けません。`);
  }

  return allow();
}

/** テスト不要の雛形にロジックが紛れ込んでいないか（index.ts は再エクスポートだけ、types.ts / .d.ts は型だけ） */
export function scaffoldContentProblem(rel, text) {
  const lines = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
  if (/(^|\/)index\.ts$/.test(rel)) {
    const ok = (l) => /^export\s+(type\s+)?(\*|\{[^}]*\})(\s+as\s+\w+)?\s+from\s+['"][^'"]+['"];?$/.test(l) || /^import\s+type\s/.test(l);
    const bad = lines.find((l) => !ok(l));
    if (bad) return `${rel} は再エクスポート（export ... from）だけを書くファイルです（「${bad.slice(0, 40)}」）。`;
  }
  if (/(^|\/)types\.ts$|\.types\.ts$|\.d\.ts$/.test(rel)) {
    const bad = lines.find((l) => /\b(function|class)\b|=>|\bexport\s+(const|let|var|default)\b|^(const|let|var)\s/.test(l));
    if (bad) return `${rel} は型定義だけを書くファイルです（「${bad.slice(0, 40)}」）。`;
  }
  return null;
}

function roleCheck(role, kind, rel, config) {
  if (role === 'main') {
    if (ROLE_WRITABLE.main.includes(kind)) return null;
    if (!config.enforcePmNoCode) return null;
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

const HUMAN_SCRIPT_NAMES = /^(approve|reject|reopen|maintenance)$/i;
const SAFE_AIDEV_SCRIPTS = /^\s*(?:npm(?:\.cmd)?\s+run\s+(?:gate|status|trace|cycle:new|wp:start|wp:merge|pr:create|test:platform)\b|node\s+(?:\.\/)?scripts[\\/](?:gate|status|trace|cycle|wp|pr)\.mjs\b)/i;
const WRITE_CMDS = new Set(['rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'chmod', 'truncate', 'install', 'unlink', 'shred', 'rsync']);
const PS_WRITE_CMDS = /^(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|sc|ac|ni|ri|del|erase|rd|copy|move|ren|cpi|mi|rni)$/i;
const INLINE_WRITE = /writeFile|appendFile|rmSync|unlinkSync|rmdirSync|renameSync|copyFile|createWriteStream|fs\.write|symlink|open\([^)]*['"][wa]['"]|WriteAllText|Set-Content|Out-File|shutil\.|os\.remove|os\.symlink/i;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const PTY_WRAPPERS = new Set(['script', 'expect', 'unbuffer', 'winpty', 'start-process', 'saps']);
const CD_CMDS = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir']);
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
    if (c === '&' && command[i + 1] !== '&' && command[i + 1] !== '>' && command[i - 1] !== '>' && command[i - 1] !== '<' && command[i - 1] !== '&') {
      // 単独の `&`（バックグラウンド実行・cmd の区切り）も、コマンドの区切りとして扱う
      if (cur.trim()) segs.push(cur.trim());
      cur = '';
      continue;
    }
    if (c === '|' && command[i - 1] === '>') {
      cur += c; // `>|`（noclobber を無視する上書きリダイレクト）は区切りではない
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

/** 入れ子のシェル（bash -c / cmd /c / powershell -Command / eval）の中身を取り出す */
function innerCommand(cmd, toks) {
  const args = toks.slice(1);
  if (SHELLS.has(cmd)) {
    const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/i.test(a));
    if (i >= 0 && args[i + 1] !== undefined) return args.slice(i + 1).join(' ');
  }
  if (cmd === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a));
    if (i >= 0) return args.slice(i + 1).join(' ');
  }
  if (cmd === 'powershell' || cmd === 'pwsh') {
    const i = args.findIndex((a) => /^-(c|command)$/i.test(a));
    if (i >= 0) return args.slice(i + 1).join(' ');
  }
  if (cmd === 'eval' || cmd === 'invoke-expression' || cmd === 'iex') return args.join(' ');
  return null;
}

export function checkBash(ctx, depth = 0) {
  const { root, command } = ctx;
  const state = ctx.state || deriveState(root);
  let branch = ctx.branch ?? currentBranch(root);
  const branching = ctx.branching || loadBranching(root);
  let cwd = ctx.cwd || root;

  if (depth > 4) return deny('入れ子のシェルが深すぎます。');
  // コマンド置換 $(…)・バッククォート・プロセス置換 <(…) の中身も、同じ規則で判定する
  for (const m of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`|<\(([^()]*)\)/g)) {
    const inner = m[1] ?? m[2] ?? m[3];
    if (!inner || !inner.trim()) continue;
    const r = checkBash({ ...ctx, command: inner, cwd, state, branch, branching }, depth + 1);
    if (!r.allow) return r;
  }
  if (/--no-verify\b/.test(command)) return deny('--no-verify（フックの無効化）は使えません。');
  if (/core\.hooksPath/i.test(command) && !/^\s*npm run setup\s*$/.test(command)) return deny('git フックの設定は変更できません。');
  if (/\bmklink\b|\bfsutil\s+hardlink\b|-ItemType\s+['"]?(SymbolicLink|Junction|HardLink)/i.test(command))
    return deny('シンボリックリンク・ジャンクションは作れません（保護パスの判定を迂回できるため）。');
  if (/\bGIT_(CONFIG|DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE|SSH|EXEC_PATH|NAMESPACE|COMMON_DIR)\w*\s*=/i.test(command))
    return deny('GIT_* 環境変数による git の動作の変更は使えません（push 先・保護対象の判定を変えられるため）。');
  // PowerShell の .NET 呼び出しによる書き込み（パスを特定できないので、書く操作そのものを止める。~/.claude の設定などを書き換えられるため）
  if (/\[\s*(System\.)?IO\.(File|Directory|StreamWriter|FileStream)\s*\]\s*::\s*(Write|Append|Create|Copy|Move|Delete|Open|Replace|Set)|New-Object\s+(System\.)?IO\.(StreamWriter|FileStream)/i.test(command))
    return deny('PowerShell の .NET 呼び出し（[IO.File]::WriteAllText など）による書き込みは使えません（書き込み先を検査できないため）。', 'Write / Edit ツールを使ってください。');
  // GitHub への GET 以外の HTTP 要求（gh api を介さない curl・Invoke-RestMethod）と、認証情報の取り出し
  if (/(api\.github\.com|\bgithub\.com)/i.test(command) && /(\s-X\s*=?\s*(POST|PUT|PATCH|DELETE)\b|--request\s*=?\s*(POST|PUT|PATCH|DELETE)\b|\s-d\s|\s-d\S|--data|\s-T\s|--upload-file|-Method\s+(Post|Put|Patch|Delete)\b|--form\b|\s-F\s)/i.test(command))
    return deny('GitHub への GET 以外の HTTP 要求は使えません（ブランチ保護・PR の手順を迂回できるため）。');
  if (/\bgit\s+credential\s+(fill|approve|reject)\b/i.test(command)) return deny('git credential による認証情報の取り出しは使えません。');
  if (/api\.github\.com/i.test(command) && /\/(merges?|reviews|protection|rulesets)\b|graphql/i.test(command))
    return deny('GitHub API によるマージ・承認・保護設定の変更はできません。');

  for (const seg of splitSegments(command)) {
    const parsed = parseSegment(seg);
    if (!parsed) continue;
    const { toks, cmd } = parsed;

    // cd でカレントディレクトリが変わる（以降のセグメントの相対パスはここから解決）
    if (CD_CMDS.has(cmd)) {
      const dest = toks.slice(1).find((a) => !a.startsWith('-'));
      if (dest) cwd = path.resolve(cwd, dest.replace(/^~(?=$|[\\/])/, os.homedir()));
      continue;
    }

    // 入れ子のシェルは中身も同じ規則で判定する
    const inner = innerCommand(cmd, toks);
    if (inner !== null) {
      const r = checkBash({ ...ctx, command: inner, cwd, state, branch, branching }, depth + 1);
      if (!r.allow) return r;
      continue;
    }

    // 人間専用のスクリプトの実行（読むだけなら可）
    // npm / npx / pnpm / yarn は、run の別名（rum・urn）・オプションの前置（--silent・--prefix .）があっても、引数に人間専用の名前があれば止める
    if (['npm', 'npx', 'pnpm', 'yarn'].includes(cmd) && toks.slice(1).some((t) => HUMAN_SCRIPT_NAMES.test(t))) {
      return deny('承認・差し戻し・メンテナンスの操作は人間だけが行えます。', '人間に依頼してください（ターミナルで npm run approve など）。');
    }
    const runName = cmd === 'npm' && ['run', 'run-script'].includes(toks[1]) ? toks[2] : null;
    const scriptFile = ['node', 'deno', 'bun'].includes(cmd) ? toks.slice(1).find((a) => !a.startsWith('-')) : toks[0];
    const scriptBase = scriptFile ? path.basename(scriptFile).replace(/\.m?js$/, '') : '';
    if ((runName && HUMAN_SCRIPT_NAMES.test(runName)) || (HUMAN_SCRIPT_NAMES.test(scriptBase) && (/scripts[\\/]/.test(scriptFile || '') || ['node', 'deno', 'bun'].includes(cmd)))) {
      return deny('承認・差し戻し・メンテナンスの操作は人間だけが行えます。', '人間に依頼してください（ターミナルで npm run approve など）。');
    }

    if (PTY_WRAPPERS.has(cmd)) return deny(`${cmd}（疑似端末・別コンソールの起動）は使えません（人間専用スクリプトの端末判定を迂回できるため）。`);

    // 任意コードの実行でゲートの内部を直接使う経路（承認・メンテナンス・記録の偽造）を止める
    const guardInterp = checkInterpreter(cmd, toks, seg, cwd, root);
    if (guardInterp) return guardInterp;

    // .ai-dev への書き込みは決められたスクリプト経由のみ
    if (/\.ai-dev/.test(seg) && !SAFE_AIDEV_SCRIPTS.test(seg) && isWritingSegment(seg, cmd, toks)) {
      return deny('.ai-dev（ゲートの状態）はスクリプト経由でのみ更新できます。', 'npm run gate / npm run status を使ってください。');
    }

    if (cmd === 'ln') return deny('リンクは作れません（保護パスの判定を迂回できるため）。');
    if (cmd === 'git') {
      const r = checkGit(toks.slice(1), branch, state, protectedBranches(branching), root);
      if (r) return r;
      branch = switchedBranch(toks.slice(1)) ?? branch; // git switch main && git merge … のように、同じコマンドの中でブランチが変わる
      // checkout -- / restore / rm / mv は下の書き込み先チェックへ進む
    }
    if (cmd === 'gh') {
      const r = checkGh(toks.slice(1), branch);
      if (r) return r;
      continue;
    }
    // npm の直後でなくても（--silent・--prefix . などが前置されても）判定する
    const npmArgs = cmd === 'npm' ? toks.slice(1) : [];
    const pkgEdit = npmArgs.includes('pkg') && npmArgs.some((t) => ['set', 'delete'].includes(t));
    const cfgSet = npmArgs.includes('config') && npmArgs.includes('set');
    if (cmd === 'npm' && (pkgEdit || cfgSet || npmArgs.includes('set-script')) && !state.maintenance) {
      return deny('package.json の scripts / npm の設定は変更できません。');
    }
    if (INTERPRETERS.includes(cmd) && /\s(-e|-c|-p|--eval|--print)\s/i.test(' ' + seg + ' ')) {
      if (INLINE_WRITE.test(seg)) {
        for (const p of mentionedPaths(seg, cwd)) {
          const r = checkWrite({ root, absPath: p, agentType: ctx.agentType, state, branch });
          if (!r.allow) return deny(`インラインスクリプトから保護対象へ書き込もうとしています: ${r.reason}`, r.hint);
        }
      }
    }
    if (cmd === 'patch') return deny('patch による一括変更は使えません。', 'Edit / Write ツールで変更してください。');

    for (const t of writeTargets(seg, cmd, toks)) {
      if (/^(\/dev\/null|nul|\$null|&\d)$/i.test(t)) continue;
      const abs = path.resolve(cwd, t.replace(/[*?].*$/, '') || '.');
      const rel = toRel(canonicalPath(root), canonicalPath(abs));
      // ディレクトリごとの削除・移動
      if (rel !== null && (['rm', 'rmdir', 'mv', 'remove-item', 'ri', 'del', 'rd', 'move-item', 'mi'].includes(cmd) || /[*?]/.test(t))) {
        const isAncestorOfGuarded = rel === '' || GUARDED_DIRS.some((d) => rel === d || d.startsWith(rel + '/'));
        const isDirInsideGuarded = (isDir(abs) || /[*?]/.test(t)) && GUARDED_DIRS.some((d) => rel.startsWith(d + '/'));
        if (isAncestorOfGuarded || isDirInsideGuarded)
          return deny(`${rel || '(ルート)'} をディレクトリごと（またはワイルドカードで）削除・移動することはできません。`, '個別のファイルを Edit / Write で変更してください。');
      }
      const r = checkWrite({ root, absPath: abs, agentType: ctx.agentType, state, branch });
      if (!r.allow) return deny(`コマンドで書き込もうとしています: ${r.reason}`, r.hint);
    }
  }
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
  return writeTargets(seg, cmd, toks).length > 0 || INLINE_WRITE.test(seg) || /\bsed\b.*\s-i/.test(seg) || (cmd === 'git' && /\b(checkout|restore|rm|mv|clean)\b/.test(seg));
}

/** セグメントから書き込み先のパスを抽出する（PostToolUse の作成者記録でも使う） */
export function writeTargets(seg, cmd, toks) {
  const targets = [];
  // リダイレクト（引用符の中の > は無視する）
  const quoted = [];
  const bare = seg.replace(/"[^"]*"|'[^']*'/g, (q) => `\u0000${quoted.push(q.slice(1, -1)) - 1}\u0000`);
  for (const m of bare.matchAll(/(?:^|[^<>&0-9=-])(?:\d|&)?>>?\|?\s*([^\s;|&<>]+)/g)) {
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

/** セグメントを解析する（VAR=x の除去、sudo / env / command / exec の除去）。checkBash と commandWriteTargets で共用 */
function parseSegment(seg) {
  const toks = tokenize(seg);
  for (;;) {
    while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) toks.shift(); // VAR=x cmd
    // 制御構文の語（if cond; then cmd; fi など）。後ろに続くのが本来のコマンド
    while (toks.length && ['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '(', '}', ')'].includes(toks[0])) toks.shift();
    if (['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'timeout', 'nice', 'stdbuf'].includes(toks[0])) {
      const wrapper = toks.shift();
      // ラッパーのオプションを飛ばす（env -u NAME / sudo -u user / exec -a name / timeout 10s など）
      while (toks.length && toks[0].startsWith('-')) {
        const opt = toks.shift();
        if (['-u', '-C', '-g', '-U', '-a', '-S', '-n', '-s', '-k'].includes(opt) && toks.length) toks.shift();
      }
      if (wrapper === 'timeout' && toks.length && /^\d/.test(toks[0])) toks.shift();
    } else break;
  }
  if (!toks.length) return null;
  return { toks, cmd: path.basename(toks[0]).toLowerCase().replace(/\.(exe|cmd|bat)$/, '') };
}

const expandHome = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());

/** コマンド全体から書き込み先を抽出する（入れ子のシェル・cd・~ も checkBash と同じ規則で扱う） */
export function commandWriteTargets(command, cwd, depth = 0) {
  const out = [];
  let dir = cwd;
  if (depth > 4) return out;
  for (const seg of splitSegments(command)) {
    const parsed = parseSegment(seg);
    if (!parsed) continue;
    const { toks, cmd } = parsed;
    if (CD_CMDS.has(cmd)) {
      const dest = toks.slice(1).find((a) => !a.startsWith('-'));
      if (dest) dir = path.resolve(dir, expandHome(dest));
      continue;
    }
    const inner = innerCommand(cmd, toks);
    if (inner !== null) {
      out.push(...commandWriteTargets(inner, dir, depth + 1));
      continue;
    }
    for (const t of writeTargets(seg, cmd, toks)) if (!/^(\/dev\/null|nul|\$null|&\d)$/i.test(t)) out.push(path.resolve(dir, expandHome(t)));
  }
  return out;
}

function mentionedPaths(seg, cwd) {
  const out = new Set();
  for (const m of seg.matchAll(/['"`]([^'"`]*?(?:\.ai-dev|\.claude|scripts|\.githooks|\.github|docs|src|e2e|tests|package\.json|CLAUDE\.md|README\.md|\.npmrc|\.gitignore)[^'"`]*)['"`]/g)) {
    out.add(path.resolve(cwd, m[1]));
  }
  return [...out];
}

/** AI が push できるブランチ（main・develop などの保護ブランチへは PR 経由） */
const ALLOWED_PUSH = [/^cycle\//, /^wp\//, /^plan\//];

/** 人間のゲート記録（承認・メンテナンス・設定と、今のサイクルの承認・ゲート） */
function protectedRecords(cycle) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.ai-dev/(approvals/|maintenance\\.json$|config\\.json$${cycle ? `|cycles/${esc(cycle)}/(approvals|gates)/` : ''})`);
}

/** ref へ切り替え・マージすると、ゲートの記録が変わる（差し戻しの取り消しなど）か。変わるなら該当のパスを返す */
function recordsChangedBy(root, state, ref, mode) {
  if (!root || !ref || ref.startsWith('-')) return null;
  const range = mode === 'merge' ? [`HEAD...${ref}`] : ['HEAD', ref];
  const out = git(root, ['diff', '--name-only', ...range]);
  if (!out) return null;
  const re = protectedRecords(state?.cycle);
  return out.split(/\r?\n/).find((f) => re.test(f)) || null;
}

/** git switch / checkout で切り替わる先のブランチ名（新規作成も含む）。なければ null */
export function switchedBranch(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += args[i] === '-C' ? 2 : 1;
  const sub = args[i];
  if (sub !== 'switch' && sub !== 'checkout') return null;
  const rest = args.slice(i + 1);
  const f = rest.findIndex((a) => ['-b', '-B', '-c', '-C'].includes(a));
  if (f >= 0) return rest[f + 1] || null;
  if (rest.includes('--')) return null;
  return rest.find((a) => !a.startsWith('-')) || null;
}

function checkGit(args, branch, state, protectedList = ['main', 'master'], root = null) {
  // グローバルオプション（-C path / -c k=v）を飛ばす
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-c' || /^-c.+=/.test(args[i])) return deny('git -c による一時的な設定の上書きは使えません（フック・push 先などを変えられるため）。');
    if (args[i] === '-C') i += 2;
    else i += 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const has = (...f) => rest.some((a) => f.includes(a) || f.some((x) => x.startsWith('--') && a.startsWith(x + '=')));
  const onProtected = protectedList.includes(branch);

  switch (sub) {
    case 'push': {
      if (has('--force', '-f', '--force-with-lease', '--force-if-includes', '--mirror', '--delete', '-d', '--all', '--prune', '--tags'))
        return deny('force push・ブランチ削除・一括 push はできません。');
      const positional = rest.filter((a) => !a.startsWith('-'));
      const refspecs = positional.slice(1);
      const dests = refspecs.length ? refspecs.map((r) => (r.startsWith('+') ? null : r.includes(':') ? r.split(':')[1] : r === 'HEAD' ? branch : r)) : [branch];
      for (const d of dests) {
        if (!d) return deny('強制更新（+refspec）はできません。');
        const name = d.replace(/^refs\/heads\//, '');
        if (protectedList.includes(name)) return deny(`保護ブランチ（${name}）へは push できません。`, '統合は PR 経由で、人間がマージします。');
        const ok = ALLOWED_PUSH.some((re) => re.test(name)) || (state.maintenance && /^feature\//.test(name));
        if (!ok) return deny(`${name} へは push できません。AI が push できるのは cycle/* ・ wp/* ・ plan/*（メンテナンス中は feature/* も）だけです。`, '統合は PR 経由で、人間がマージします。');
      }
      return null;
    }
    case 'commit':
      if (onProtected) return deny(`保護ブランチ（${branch}）へ直接コミットすることはできません。`, 'cycle/* ブランチで作業してください（npm run cycle:new）。');
      if (has('--amend')) return deny('--amend（履歴の書き換え）はできません。新しいコミットを作ってください。');
      if (rest.includes('-n')) return deny('-n（フックの無効化）は使えません。');
      return null;
    case 'merge': {
      if (onProtected) return deny(`保護ブランチ（${branch}）へのマージは PR 経由で人間が行います。`);
      const hit = recordsChangedBy(root, state, rest.find((a) => !a.startsWith('-')), 'merge');
      if (hit) return deny(`このマージは人間のゲート記録（${hit}）を変えるため実行できません。`, 'サイクルへの統合は npm run wp:merge で行ってください。');
      return null;
    }
    case 'revert':
    case 'pull':
      return deny(
        `git ${sub} は使えません（人間の承認・差し戻しの記録など、保護対象のファイルを書き換えられるため）。`,
        sub === 'pull' ? 'git fetch の後、npm run wp:merge などの決められた手順で統合してください。' : '新しいコミットで直接修正してください。',
      );
    case 'apply':
    case 'am':
      return deny('patch による一括変更は使えません。', 'Edit / Write ツールで変更してください。');
    // 作業ツリーを任意の内容で書き換える操作（書き込み先を検査できない）
    case 'checkout-index':
    case 'read-tree':
    case 'cherry-pick':
    case 'clone':
    case 'init':
      return deny(`git ${sub} は使えません（保護対象のファイルを書き換えられるため）。`, 'Edit / Write ツールで変更してください。');
    case 'stash':
      if (['pop', 'apply', 'branch'].includes(rest[0])) return deny('git stash pop / apply は使えません（保護対象のファイルを書き換えられるため）。');
      return null;
    case 'checkout':
    case 'switch':
      // `git checkout <ref> <path>`（-- なし）はパスの内容を ref のもので上書きする。ブランチの切り替えと作成だけ許す
      if (sub === 'checkout' && !has('-b', '-B', '-c', '-C', '--orphan', '--detach', '-d') && rest.filter((a) => !a.startsWith('-') && a !== '--').length >= 2 && !rest.includes('--'))
        return deny('git checkout <ref> <path> は使えません（保護対象のファイルを書き換えられるため）。', 'Edit / Write ツールで変更してください。');
      {
        // 差し戻し前のコミットへ切り替える・その上に新しいブランチを作る、で人間の差し戻しを取り消されないようにする
        const target = has('-b', '-B', '-c', '-C') ? rest.filter((a) => !a.startsWith('-'))[1] : rest.find((a) => !a.startsWith('-'));
        const hit = recordsChangedBy(root, state, target, 'switch');
        if (hit) return deny(`この切り替えは人間のゲート記録（${hit}）を別の内容に戻してしまうため実行できません。`, 'ブランチの切り替えは npm run cycle:new などの決められた手順で行ってください。');
      }
      return null;
    case 'rebase':
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
    case 'update-ref':
    case 'symbolic-ref':
      return deny(`git ${sub}（履歴・参照の書き換え）はできません。`);
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
      // 読み取り（--get / --list など、または値なしのキー指定）だけ許可する。書き込みはすべて禁止
      if (has('--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin', '--show-scope', '--help')) return null;
      if (rest.filter((a) => !a.startsWith('-')).length <= 1 && !has('--add', '--unset', '--unset-all', '--replace-all', '--edit', '-e', '--rename-section', '--remove-section', '--file', '-f', '--global', '--system', '--local', '--worktree')) return null;
      return deny('git config による設定の変更は使えません（push 先・フック・include などを変えられるため）。');
    case 'worktree':
      if (rest[0] === 'remove' || rest[0] === 'prune') return deny('worktree の削除は npm run wp:merge で行います。');
      return null;
    default:
      return null;
  }
}

const INTERPRETERS = ['node', 'deno', 'bun', 'python', 'python3', 'py', 'ruby', 'perl'];
const GATE_INTERNALS = /scripts[\\/]+lib|\.ai-dev|\.claude[\\/]+hooks|\b(writeJSON|writeRecord|computeArtifacts|rejectGate|requireHuman|pty|pexpect)\b|maintenance\.json|(approve|reject|reopen|maintenance)\.mjs/i;

/** node -e などでゲートの内部を使う・プロジェクト外のスクリプトを実行する、ことを止める */
function checkInterpreter(cmd, toks, seg, cwd, root) {
  if (!INTERPRETERS.includes(cmd)) return null;
  const args = toks.slice(1);
  const inline = args.some((a) => /^(-e|-p|-c|--eval|--print|--eval=.*|--print=.*)$/.test(a) || /^-[a-z]*[epc]$/i.test(a));
  if (inline && GATE_INTERNALS.test(seg))
    return deny('インラインスクリプトからゲートの内部（scripts/lib・.ai-dev・フック）は使えません。', '状態の更新は npm run gate / npm run status などの決められたコマンドで行ってください。');
  if (cmd === 'node' && args.some((a) => /^(-r|--require|--import|--loader|--experimental-loader)(=|$)/.test(a)))
    return deny('node の -r / --import / --loader による事前読み込みは使えません（ガードの迂回に使えるため）。');
  if (!inline) {
    const file = args.find((a) => !a.startsWith('-'));
    if (file && /\.(m?js|cjs|ts|py|rb|pl)$/i.test(file)) {
      const abs = path.resolve(cwd, file.replace(/^~(?=$|[\/])/, os.homedir()));
      if (toRel(canonicalPath(root), canonicalPath(abs)) === null)
        return deny('プロジェクト外のスクリプトは実行できません（一時フォルダなどに置いたスクリプトでガードを迂回できるため）。', 'プロジェクト内の許可された場所のスクリプトを使ってください。');
    }
  }
  return null;
}

const PR_HEAD_OK = /^(cycle|plan|feature)\//;

function checkGh(args, branch) {
  const [a, b] = args;
  const joined = args.join(' ');
  if (a === 'pr' && b === 'create') {
    const i = args.findIndex((x) => x === '--head' || x === '-H');
    const head = (i >= 0 ? args[i + 1] : (args.find((x) => x.startsWith('--head=')) || '').slice(7)) || branch || '';
    if (!PR_HEAD_OK.test(head))
      return deny(`ブランチ ${head || '(不明)'} からの PR は作れません。`, 'PR は cycle/*（npm run pr:create）・plan/*・feature/* のブランチからだけ作成できます。wp/* は cycle/* にマージしてください。');
  }
  if (a === 'pr' && b === 'merge') return deny('PR のマージは人間だけが行えます。');
  if (a === 'pr' && b === 'review' && args.some((x) => ['--approve', '-a'].includes(x))) return deny('PR の承認は人間だけが行えます。');
  if (a === 'repo' && ['delete', 'edit', 'rename', 'archive'].includes(b)) return deny('リポジトリ設定の変更はできません。');
  if (['secret', 'variable', 'ruleset', 'auth', 'workflow', 'extension', 'alias'].includes(a) && !(a === 'auth' && b === 'status')) return deny(`gh ${a} は人間が操作します。`);
  if (a === 'api') {
    // 読み取り（GET）だけ許可する。-f / -F / --input は POST になる、graphql は変更を隠せる、ので止める
    if (args.some((x) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(x) || /^-[fF][^-]/.test(x))) return deny('gh api は読み取り（GET）だけ使えます（-f / -F / --input は変更になります）。');
    const mi = args.findIndex((x) => x === '-X' || x === '--method' || /^(-X|--method=)./.test(x));
    if (mi >= 0) {
      const m = (args[mi] === '-X' || args[mi] === '--method' ? args[mi + 1] : args[mi].replace(/^(-X|--method=)/, '')) || '';
      if (m.toUpperCase() !== 'GET') return deny('gh api は読み取り（GET）だけ使えます。');
    }
    if (/graphql/i.test(joined)) return deny('gh api graphql は使えません（変更を隠せるため）。');
    if (/\/(merges?|reviews|protection|rulesets|collaborators|hooks|actions\/secrets)\b/.test(joined)) return deny('gh api によるマージ・承認・設定変更はできません。');
  }
  return null;
}
