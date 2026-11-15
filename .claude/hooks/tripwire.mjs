// tripwire: ツール実行の前後でテンプレートのファイルを「基準」と比べ、メンテナンスモードでないのに変わっていたら元に戻す。
//
// 他のガード（policy.mjs）は「書き込み手段の列挙」に頼るので、列挙に漏れた手段（[IO.File]::WriteAllText、xcopy、
// curl -o、tar -x、perl -pi など）や、git・別プロセス経由の書き込みを止められない。これは手段を問わず「結果」で止める最後の砦。
//
// 自己完結: scripts/ や .claude/hooks の他ファイルを import しない（それらが書き換えられても動くように）。
// 監視する範囲は config.mjs の PLATFORM と同じ。ただし CLAUDE.md 系は全階層を探して加える（一致は tests/hooks/tripwire.test.mjs で確認する）。
// 監視しないもの: ゲートの記録（gates/・runs.jsonl・activity.jsonl）。AI のツール実行の中でスクリプトやフックが正当に書くため。
//   これらの偽造は、ハッシュの照合と CI の再検証、人間の PR レビュー（CODEOWNERS）で止める。
//
// 基準（.ai-dev/.cache/tripwire/）:
//   - 基準は世代ごとのフォルダ（base-<時刻>-<pid>）に作り、最後に `current`（世代の名前だけを書いたファイル）を一時ファイル経由で置き換える。
//     フォルダを消してから作り直すことはしない（並列のツール呼び出しで「基準なし」に見える瞬間を作らない）
//   - メンテナンス中は、Pre・Post のたびに現在の状態を基準にする（変更を受け入れる）
//   - メンテナンスでなければ、Pre・Post のたびに基準と比べて、違うものを戻す（Post が発火しなかった変更・Post の後の変更も、次の Pre で戻る）
//   - 基準がない・壊れている（ファイルが欠けている・ハッシュが合わない）ときは、git の HEAD を基準にする
//     （HEAD に追跡されているファイルで内容が違うものを HEAD の内容に戻す。未追跡のファイルは触らない）
//   - HEAD が動いたとき（ブランチの切り替え・マージ・コミット）は、統合ブランチ（main / develop）か、動く前の HEAD に既にあった内容と
//     一致するファイルだけを受け入れる。ツールの中でテンプレートを書き換えて commit しただけの変更は受け入れない
//     （PR の差分で見つかる。CI の RV-PF 照合と CODEOWNERS が止める）
//   - maintenance.json は基準との比較に使わない（復元しない）。Pre では人間の操作として信用する（`maintenance -- off` が効く）。
//     Post では、Pre の時点で信用した（メンテナンス中だった）ときだけ信用し、実行中に作られたものは消す。
//     ツールの実行中に人間が `maintenance -- on` を実行すると消えるので、その場合は実行し直す
//   - 内部エラーのときは、メンテナンス中でなければ exit 2 で止める（fail-closed）
//   - tripwire 自身を入れ替えるとき（Pre は古い版、Post は新しい版が動く）のため、古い置き場所（base/）の基準も読み、
//     2 つの置き場所のうち新しい方を使う
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const WATCH_DIRS = ['.claude', 'scripts', '.githooks', '.github', 'tests/hooks', 'docs/templates', '.vscode', '.devcontainer', '.ai-dev/approvals'];
export const WATCH_FILES = [
  'docs/GETTING_STARTED.md',
  'docs/memo/00_setup_prompt.md',
  'docs/memo/01_platform_design.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'README.md',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.mcp.json',
  '.ai-dev/config.json',
];
const MAINT = '.ai-dev/maintenance.json';
// 全階層から探す名前（PLATFORM の「**／CLAUDE.md」と「**／CLAUDE.local.md」に当たる）
export const NESTED_NAMES = ['CLAUDE.md', 'CLAUDE.local.md'];

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.worktrees']);
const SKIP_PATHS = ['.claude/worktrees']; // git 管理外の worktree（Claude Code が管理する）
const CACHE = path.join('.ai-dev', '.cache', 'tripwire');
const KEEP_GENERATIONS_MS = 120_000;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const git = (root, args, opts = {}) => spawnSync('git', args, { cwd: root, encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, input: opts.input });

function walk(root, rel, out, { names } = {}) {
  if (SKIP_PATHS.includes(rel)) return;
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(abs)) if (!SKIP.has(n) && !(rel === '.ai-dev' && n === '.cache')) walk(root, rel ? `${rel}/${n}` : n, out, { names });
  } else if (st.isFile()) {
    if (!names || names.includes(path.basename(rel))) out.push(rel);
  }
}

/** .ai-dev/cycles/<サイクル>/approvals の一覧 */
function cycleApprovalDirs(root) {
  try {
    return fs.readdirSync(path.join(root, '.ai-dev', 'cycles')).map((c) => `.ai-dev/cycles/${c}/approvals`);
  } catch {
    return []; // サイクルがなければ空
  }
}

/** 監視対象の { 相対パス: ハッシュ }（maintenance.json は含めない） */
export function listWatched(root) {
  const files = [];
  for (const d of [...WATCH_DIRS, ...cycleApprovalDirs(root)]) walk(root, d, files);
  for (const f of WATCH_FILES) walk(root, f, files);
  walk(root, '', files, { names: NESTED_NAMES });
  const out = {};
  for (const f of new Set(files)) out[f] = sha(fs.readFileSync(path.join(root, f)));
  return out;
}

export function maintenanceOn(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, MAINT), 'utf8'));
    return Date.parse(m.until) > Date.now();
  } catch {
    return false;
  }
}

function findRoot(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.ai-dev')) && fs.existsSync(path.join(d, 'package.json'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

const headOf = (root) => {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.status === 0 ? String(r.stdout).trim() : '';
};

/** 現在の状態を新しい世代の基準として保存する。maint: この Pre の時点でメンテナンス中（信用した）か */
export function saveBase(root, files = listWatched(root), { maint = false } = {}) {
  const cache = path.join(root, CACHE);
  const gen = `base-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(cache, gen);
  for (const f of Object.keys(files)) {
    const dest = path.join(dir, 'files', f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ head: headOf(root), maint, files }));
  // current を一時ファイル経由で置き換える（読む側は古い世代か新しい世代のどちらかを必ず読める）
  const tmp = path.join(cache, `current.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, gen);
  fs.renameSync(tmp, path.join(cache, 'current'));
  // 古い世代を消す（読み取り中の別プロセスがいても困らないよう、少し待ってから）
  for (const n of fs.readdirSync(cache)) {
    if (!n.startsWith('base-') || n === gen) continue;
    try {
      if (Date.now() - fs.statSync(path.join(cache, n)).mtimeMs > KEEP_GENERATIONS_MS) fs.rmSync(path.join(cache, n), { recursive: true, force: true });
    } catch {
      /* 別プロセスが消した */
    }
  }
}

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1;
  }
};

/** 基準のフォルダの候補: current が指す世代と、古い置き場所（base/）のうち、index.json が新しい方 */
function baseDir(root) {
  const cache = path.join(root, CACHE);
  let gen = null;
  try {
    const g = fs.readFileSync(path.join(cache, 'current'), 'utf8').trim();
    gen = /^base-[\w.-]+$/.test(g) ? path.join(cache, g) : 'invalid';
  } catch {
    /* current がない */
  }
  const legacy = path.join(cache, 'base');
  const hasLegacy = fs.existsSync(path.join(legacy, 'index.json'));
  if (gen === 'invalid') return { corrupt: true };
  if (gen && hasLegacy) return mtime(path.join(legacy, 'index.json')) > mtime(path.join(gen, 'index.json')) ? { dir: legacy } : { dir: gen };
  if (gen) return { dir: gen };
  if (hasLegacy) return { dir: legacy };
  return null;
}

/** 基準を読む。なければ null、壊れていれば { corrupt: true } */
function loadBase(root) {
  const found = baseDir(root);
  if (!found || found.corrupt) return found;
  const dir = found.dir;
  let idx;
  try {
    idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  } catch {
    return { corrupt: true };
  }
  // 基準の中身がインデックスと合っているか（部分的な削除・書き換えを検出する）
  for (const [f, h] of Object.entries(idx.files || {})) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, 'files', f));
    } catch {
      return { corrupt: true };
    }
    if (sha(buf) !== h) return { corrupt: true };
  }
  return { ...idx, dir };
}

/** git の { パス: blob の sha1 }。ref のツリーにあるもの */
function treeBlobs(root, ref) {
  const r = git(root, ['ls-tree', '-r', ref]);
  const out = {};
  if (r.status !== 0) return out;
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/** 作業ツリーのファイルの git blob sha1（まとめて 1 回で求める） */
function workBlobs(root, files) {
  if (!files.length) return {};
  const r = git(root, ['hash-object', '--stdin-paths'], { input: files.join('\n') + '\n' });
  const hashes = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
  const out = {};
  files.forEach((f, i) => {
    out[f] = hashes[i];
  });
  return out;
}

function restoreFile(root, f, from, dir) {
  const dest = path.join(root, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (from === 'head') {
    const r = git(root, ['show', `HEAD:${f}`], { buffer: true });
    if (r.status === 0) fs.writeFileSync(dest, r.stdout);
  } else {
    fs.copyFileSync(path.join(dir, 'files', f), dest);
  }
}

/** 消えているファイルが監視対象の場所にあるか（HEAD から戻すかの判定） */
function isWatchedPath(f) {
  if (WATCH_FILES.includes(f)) return true;
  if (WATCH_DIRS.some((d) => f.startsWith(d + '/'))) return true;
  if (/^\.ai-dev\/cycles\/[^/]+\/approvals\//.test(f)) return true;
  return NESTED_NAMES.includes(path.basename(f)) && !SKIP_PATHS.some((p) => f.startsWith(p + '/'));
}

/**
 * 統合ブランチ（origin/main・origin/develop。ローカルの main は AI が動かせるので使わない）と、基準を取った時点の HEAD にある
 * （パス, blob）の組の集合。HEAD が動いたときに、Post で受け入れてよい内容。パスも合わせて見る（別のファイルの内容への置き換えを防ぐ）
 */
function knownPairs(root, baseHead) {
  const set = new Set();
  for (const ref of ['origin/main', 'origin/develop', baseHead].filter(Boolean)) for (const [p, b] of Object.entries(treeBlobs(root, ref))) set.add(`${p}\0${b}`);
  return set;
}

/**
 * 基準と比べ、変わったものを元に戻す。戻したパスの一覧を返す。
 * メンテナンス中は基準を更新するだけで、何も戻さない。
 * phase: 'pre' はツール実行の前（人間の操作は呼び出しの合間に行われるので、このときの maintenance.json を信用する）。
 *        'post' はツール実行の後（Pre の時点でメンテナンス中として信用したときだけ、メンテナンス中として扱う）
 */
export function syncWithBase(root, phase = 'pre') {
  const base = loadBase(root);
  const usable = base && !base.corrupt ? base : null;
  const trustMaint = phase === 'pre' ? maintenanceOn(root) : Boolean(usable?.maint) && maintenanceOn(root);
  if (trustMaint) {
    saveBase(root, listWatched(root), { maint: true });
    return [];
  }
  const now = listWatched(root);
  const reverted = [];

  // 実行中に作られた maintenance.json は信用せず消す（Pre で信用していたなら上で return している）
  if (phase === 'post' && fs.existsSync(path.join(root, MAINT))) {
    fs.rmSync(path.join(root, MAINT), { force: true });
    reverted.push(MAINT);
  }

  if (!usable) {
    // 基準がない・壊れている: HEAD に追跡されているファイルで内容が違うものを HEAD の内容に戻す。未追跡のファイルは触らない
    const blobs = treeBlobs(root, 'HEAD');
    const tracked = Object.keys(now).filter((f) => f in blobs);
    const wb = workBlobs(root, tracked);
    for (const f of tracked) {
      if (wb[f] === blobs[f]) continue;
      restoreFile(root, f, 'head');
      reverted.push(f);
    }
    // HEAD にあって監視対象の場所から消えているファイルも戻す
    for (const f of Object.keys(blobs)) {
      if (f in now || fs.existsSync(path.join(root, f)) || !isWatchedPath(f)) continue;
      restoreFile(root, f, 'head');
      reverted.push(f);
    }
    saveBase(root, listWatched(root));
    if (base?.corrupt) reverted.push('(tripwire の基準が壊れていたため、HEAD を基準に作り直しました)');
    return reverted;
  }

  const headNow = headOf(root);
  const headMoved = usable.head && headNow && usable.head !== headNow;
  const accept = new Set();
  if (headMoved) {
    // ブランチの切り替え・マージ・コミット。HEAD の内容と一致するファイルを受け入れる。
    //   Pre: 人間の操作（承認・差し戻しの記録の commit、git pull など）はツール実行の合間に起きるので、HEAD と一致すれば受け入れる
    //   Post: ツールの中で起きた HEAD の移動。AI が書き換えて commit しただけの変更を通さないよう、
    //         origin/<統合ブランチ> か元の HEAD に同じパスで同じ内容があるものだけ受け入れる（cycle:new の切り替えなど）
    const blobs = treeBlobs(root, 'HEAD');
    const cand = Object.keys(now).filter((f) => f in blobs && now[f] !== usable.files[f]);
    const wb = workBlobs(root, cand);
    const known = phase === 'post' ? knownPairs(root, usable.head) : null;
    for (const f of cand) if (wb[f] === blobs[f] && (!known || known.has(`${f}\0${blobs[f]}`))) accept.add(f);
    // HEAD に存在しないファイルが基準にあれば、ブランチの切り替えで消えたものとして受け入れる
    for (const f of Object.keys(usable.files)) if (!(f in now) && !(f in blobs)) accept.add(f);
  }
  for (const [f, h] of Object.entries(usable.files)) {
    if (now[f] === h || accept.has(f)) continue;
    restoreFile(root, f, 'base', usable.dir);
    reverted.push(f);
  }
  for (const f of Object.keys(now)) {
    if (f in usable.files || accept.has(f)) continue;
    fs.rmSync(path.join(root, f), { force: true });
    reverted.push(f);
  }
  if (reverted.length || headMoved || accept.size) saveBase(root, listWatched(root));
  return reverted;
}

async function main() {
  let data = '';
  for await (const c of process.stdin) data += c;
  let input = {};
  try {
    input = JSON.parse(data || '{}');
  } catch {
    /* 入力なしは何もしない */
  }
  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (!root) return;
  let reverted;
  try {
    reverted = syncWithBase(root, input.hook_event_name === 'PostToolUse' ? 'post' : 'pre');
  } catch (e) {
    // 内部エラー（基準の読み書きの失敗など）は、メンテナンス中でなければ止める（fail-closed）
    if (maintenanceOn(root)) return;
    process.stderr.write(`[GATE] tripwire の内部エラーのため止めました（${String(e?.message || e).slice(0, 120)}）。人間に報告してください。\n`);
    process.exit(2);
  }
  if (reverted.length) {
    process.stderr.write(
      `[GATE] テンプレートのファイルがメンテナンスモードでないのに変更されたため、元に戻しました（${reverted.slice(0, 8).join(', ')}${reverted.length > 8 ? ' ほか' : ''}）。\n` +
        '変更が必要なら、作業を止めて人間に `npm run maintenance -- on` を依頼してください。別の手段で書き直さないでください。\n',
    );
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith('tripwire.mjs')) {
  main().catch(() => process.exit(0));
}
