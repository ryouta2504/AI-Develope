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
// 基準（.ai-dev/.cache/tripwire/base）:
//   - メンテナンス中は、Pre・Post のたびに現在の状態を基準にする（変更を受け入れる）
//   - メンテナンスでなければ、Pre・Post のたびに基準と比べて、違うものを戻す（Post が発火しなかった変更・Post の後の変更も、次の Pre で戻る）
//   - 基準がない（消された・初回）ときは、git の HEAD を基準にする（変更されたファイルを HEAD の内容に戻す。未追跡のファイルは触らない）
//   - HEAD が基準の記録から変わったとき（ブランチの切り替え・マージ・コミット）は、HEAD の内容と一致するファイルだけを受け入れる
//     （人間の PR レビューを経ない書き換えを git コミットで通す経路は残る。CI の RV-PF 照合と CODEOWNERS で止める）
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
  '.ai-dev/maintenance.json',
];
// 全階層から探す名前（PLATFORM の「**／CLAUDE.md」と「**／CLAUDE.local.md」に当たる）
export const NESTED_NAMES = ['CLAUDE.md', 'CLAUDE.local.md'];
/** サイクルごとの人間の承認記録（G1〜G3）: .ai-dev/cycles/<サイクル>/approvals */
export const CYCLE_APPROVALS = ['.ai-dev', 'cycles', '*', 'approvals'];

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.worktrees']);
const BASE = path.join('.ai-dev', '.cache', 'tripwire', 'base');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const git = (root, args, opts = {}) => spawnSync('git', args, { cwd: root, encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, input: opts.input });

function walk(root, rel, out, { names } = {}) {
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
  const cyclesDir = path.join(root, '.ai-dev', 'cycles');
  let cycles = [];
  try {
    cycles = fs.readdirSync(cyclesDir);
  } catch {
    /* サイクルがなければ空 */
  }
  return cycles.map((c) => `.ai-dev/cycles/${c}/approvals`);
}

/** 監視対象の { 相対パス: ハッシュ } */
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
    const m = JSON.parse(fs.readFileSync(path.join(root, '.ai-dev', 'maintenance.json'), 'utf8'));
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

/** 現在の状態を基準として保存する */
export function saveBase(root, files = listWatched(root), maint = false) {
  const baseDir = path.join(root, BASE);
  fs.rmSync(baseDir, { recursive: true, force: true });
  for (const f of Object.keys(files)) {
    const dest = path.join(baseDir, 'files', f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest);
  }
  fs.writeFileSync(path.join(baseDir, 'index.json'), JSON.stringify({ head: headOf(root), maint, files }));
}

function loadBase(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, BASE, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** HEAD のコミットにある blob の { パス: blob の sha1 } */
function headBlobs(root) {
  const r = git(root, ['ls-tree', '-r', 'HEAD']);
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

function restoreFile(root, f, from) {
  const dest = path.join(root, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (from === 'head') {
    const r = git(root, ['show', `HEAD:${f}`], { buffer: true });
    if (r.status === 0) fs.writeFileSync(dest, r.stdout);
  } else {
    fs.copyFileSync(path.join(root, BASE, 'files', f), dest);
  }
}

/**
 * 基準と比べ、変わったものを元に戻す。戻したパスの一覧を返す。
 * メンテナンス中は基準を更新するだけで、何も戻さない。
 * phase: 'pre' はツール実行の前（人間の操作は呼び出しの合間に行われるので、このときの maintenance.json を信用する）。
 *        'post' はツール実行の後（実行中に偽造された maintenance.json は信用せず、Pre の時点でメンテナンス中だったかを基準の記録で見る。
 *        maint の記録がない旧形式の基準のときだけ、現在の maintenance.json を信用する）
 */
export function syncWithBase(root, phase = 'pre') {
  const base0 = loadBase(root);
  const trustMaint = phase === 'pre' || base0?.maint === undefined ? maintenanceOn(root) && (phase === 'pre' || Boolean(base0)) : Boolean(base0.maint);
  if (trustMaint) {
    saveBase(root, listWatched(root), true);
    return [];
  }
  const base = base0;
  const now = listWatched(root);
  const reverted = [];

  if (!base) {
    // Post なのに基準がない = 実行中に基準が消された。maintenance.json も実行中に作られたものとして信用しない（消す）
    const maintFile = path.join(root, '.ai-dev', 'maintenance.json');
    if (phase === 'post' && fs.existsSync(maintFile)) {
      fs.rmSync(maintFile, { force: true });
      reverted.push('.ai-dev/maintenance.json');
      delete now['.ai-dev/maintenance.json'];
    }
    // 基準がない（消された・初回）: HEAD に追跡されているファイルで内容が違うものを HEAD の内容に戻す。未追跡のファイルは触らない
    const blobs = headBlobs(root);
    const tracked = Object.keys(now).filter((f) => f in blobs);
    const wb = workBlobs(root, tracked);
    for (const f of tracked) {
      if (wb[f] === blobs[f]) continue;
      restoreFile(root, f, 'head');
      reverted.push(f);
    }
    // HEAD にあって監視対象の場所から消えているファイルも戻す
    for (const f of Object.keys(blobs)) {
      if (f in now || fs.existsSync(path.join(root, f))) continue;
      if (isWatchedPath(root, f)) {
        restoreFile(root, f, 'head');
        reverted.push(f);
      }
    }
    saveBase(root);
    return reverted;
  }

  const headNow = headOf(root);
  const headMoved = base.head && headNow && base.head !== headNow;
  let accept = new Set();
  if (headMoved) {
    // ブランチの切り替え・マージ・コミット: HEAD の内容と一致するファイルは正当な変更として受け入れる
    const blobs = headBlobs(root);
    const cand = Object.keys(now).filter((f) => f in blobs && now[f] !== base.files[f]);
    const wb = workBlobs(root, cand);
    accept = new Set(cand.filter((f) => wb[f] === blobs[f]));
    // HEAD に存在しないファイルが基準にあれば、ブランチの切り替えで消えたものとして受け入れる
    for (const f of Object.keys(base.files)) if (!(f in now) && !(f in blobs)) accept.add(f);
  }
  const files = { ...now };
  for (const [f, h] of Object.entries(base.files)) {
    if (now[f] === h || accept.has(f)) continue;
    restoreFile(root, f, 'base');
    files[f] = h;
    reverted.push(f);
  }
  for (const f of Object.keys(now)) {
    if (f in base.files || accept.has(f)) continue;
    fs.rmSync(path.join(root, f), { force: true });
    delete files[f];
    reverted.push(f);
  }
  if (reverted.length || headMoved || accept.size) saveBase(root, listWatched(root));
  return reverted;
}

/** 消えているファイルが監視対象の場所にあるか（HEAD から戻すかの判定） */
function isWatchedPath(root, f) {
  if (WATCH_FILES.includes(f)) return true;
  if (WATCH_DIRS.some((d) => f.startsWith(d + '/'))) return true;
  if (/^\.ai-dev\/cycles\/[^/]+\/approvals\//.test(f)) return true;
  return NESTED_NAMES.includes(path.basename(f));
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
  const reverted = syncWithBase(root, input.hook_event_name === 'PostToolUse' ? 'post' : 'pre');
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
