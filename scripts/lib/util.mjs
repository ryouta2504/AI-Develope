// 共通ユーティリティ: パス・ハッシュ・JSON・glob・git
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** POSIX 形式の相対パスに正規化する（root の外なら null） */
export function toRel(root, p) {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** 指定パスから上に辿り、.ai-dev を持つディレクトリ（プロジェクトルート / worktree ルート）を探す */
export function findRoot(start) {
  if (!start) return null;
  let dir = path.resolve(start);
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  for (;;) {
    if (fs.existsSync(path.join(dir, '.ai-dev')) && fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 改行コードを LF に揃えた内容の SHA-256（Windows と CI でハッシュを一致させるため） */
export function hashContent(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export function hashFile(absPath) {
  try {
    return hashContent(fs.readFileSync(absPath));
  } catch {
    return 'MISSING';
  }
}

const TREE_IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage', '.vite', 'test-results', 'playwright-report']);

/** ディレクトリ配下のファイルを相対パス（POSIX）で列挙する */
export function listFiles(root, relDir) {
  const out = [];
  const base = path.join(root, relDir);
  if (!fs.existsSync(base)) return out;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (TREE_IGNORE.has(ent.name)) continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(toRel(root, abs));
    }
  };
  walk(base);
  return out.sort();
}

/** ディレクトリ全体のハッシュ（ファイル名 + 内容） */
export function hashTree(root, relDir) {
  const files = listFiles(root, relDir);
  if (files.length === 0) return 'EMPTY';
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f + '\0' + hashFile(path.join(root, f)) + '\n');
  return h.digest('hex');
}

export function readJSON(absPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2) + '\n');
}

export function readText(absPath, fallback = null) {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return fallback;
  }
}

/** シンプルな glob → 正規表現（** / * / ? に対応） */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" は 0 個以上のディレクトリ
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}

export function matchAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

export function git(root, args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.throwOnError) throw e;
    return null;
  }
}

export function currentBranch(root) {
  return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
}

export function nowIso() {
  return new Date().toISOString();
}
