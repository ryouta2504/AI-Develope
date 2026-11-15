// tripwire: ツール実行の前後でテンプレートのファイルを比べ、メンテナンスモードでないのに変わっていたら元に戻す。
//
// 他のガード（policy.mjs）は「書き込み手段の列挙」に頼るので、列挙に漏れた手段（[IO.File]::WriteAllText、xcopy、
// curl -o、tar -x、perl -pi など）や、git・別プロセス経由の書き込みを止められない。これは手段を問わず「結果」で止める最後の砦。
//
// 自己完結: scripts/ や .claude/hooks の他ファイルを import しない（それらが書き換えられても動くように）。
// 監視する範囲は config.mjs の PLATFORM と同じ（一致は tests/hooks/tripwire.test.mjs で確認する）。
//   PreToolUse : 監視対象のスナップショット（内容のコピー）を取る。メンテナンス中は何もしない
//   PostToolUse: 差分があれば、スナップショットから元に戻して exit 2 で知らせる
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const WATCH_DIRS = ['.claude', 'scripts', '.githooks', '.github', 'tests/hooks', 'docs/templates', '.vscode', '.devcontainer', '.ai-dev/approvals'];
export const WATCH_FILES = [
  'docs/GETTING_STARTED.md',
  'docs/memo/00_setup_prompt.md',
  'docs/memo/01_platform_design.md',
  'CLAUDE.md',
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
const SKIP = new Set(['node_modules', '.git']);
const SNAP = path.join('.ai-dev', '.cache', 'tripwire');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(abs)) if (!SKIP.has(n)) walk(root, `${rel}/${n}`, out);
  } else if (st.isFile()) {
    out.push(rel);
  }
}

/** 監視対象の { 相対パス: ハッシュ } */
export function listWatched(root) {
  const files = [];
  for (const d of WATCH_DIRS) walk(root, d, files);
  for (const f of WATCH_FILES) walk(root, f, files);
  const out = {};
  for (const f of files) out[f] = sha(fs.readFileSync(path.join(root, f)));
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

export function takeSnapshot(root) {
  const snapDir = path.join(root, SNAP);
  fs.rmSync(snapDir, { recursive: true, force: true });
  if (maintenanceOn(root)) return;
  const files = listWatched(root);
  for (const f of Object.keys(files)) {
    const dest = path.join(snapDir, 'files', f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest);
  }
  fs.writeFileSync(path.join(snapDir, 'index.json'), JSON.stringify(files));
}

/** スナップショットと比べ、変わったものを元に戻す。戻したパスの一覧を返す */
export function restoreFromSnapshot(root) {
  const snapDir = path.join(root, SNAP);
  const idx = path.join(snapDir, 'index.json');
  if (!fs.existsSync(idx)) return []; // スナップショットがない = Pre の時点でメンテナンス中。Post の時点の maintenance.json は信用しない（偽造されうる）
  const before = JSON.parse(fs.readFileSync(idx, 'utf8'));
  const now = listWatched(root);
  const reverted = [];
  for (const [f, h] of Object.entries(before)) {
    if (now[f] === h) continue;
    const dest = path.join(root, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(snapDir, 'files', f), dest);
    reverted.push(f);
  }
  for (const f of Object.keys(now)) {
    if (f in before) continue;
    fs.rmSync(path.join(root, f), { force: true });
    reverted.push(f);
  }
  fs.rmSync(snapDir, { recursive: true, force: true });
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
  if (input.hook_event_name === 'PreToolUse') {
    takeSnapshot(root);
    return;
  }
  const reverted = restoreFromSnapshot(root);
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
