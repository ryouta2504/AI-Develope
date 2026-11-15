// PreToolUse: mcp__.*（MCP サーバーのツール）
// MCP ツールはファイル書き込みや外部サービスの変更ができるため、フックの判定を迂回しうる。
// 読み取り系（get / list / read / search / query など）は許可し、それ以外は .ai-dev/config.json の mcpAllow に
// 人間が登録したものだけを許可する。
import fs from 'node:fs';
import path from 'node:path';
import { readInput, block } from './_io.mjs';
import { findRoot } from '../../scripts/lib/util.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';

// 読み取り専用と確実に言える名前だけ許可する: 先頭の語が読み取りの動詞で、変更を示す語を含まない（小文字の snake_case のみ）。
// query（SQL の実行）・fetch（HTTP の送信）・find_and_replace などは対象外。それ以外は mcpAllow への登録が必要
const READ_VERBS = new Set(['get', 'list', 'read', 'search', 'describe', 'view', 'show', 'status', 'guide']);
const MUTATING = new Set(['update', 'delete', 'create', 'set', 'put', 'post', 'send', 'write', 'replace', 'remove', 'add', 'exec', 'execute', 'run', 'query', 'fetch', 'find_and_replace', 'edit', 'move', 'rename', 'merge', 'push', 'upload', 'publish', 'approve', 'import']);
const isReadOnlyName = (tool) => {
  if (!/^[a-z][a-z0-9_]*$/.test(tool)) return false;
  const tokens = tool.split('_');
  return READ_VERBS.has(tokens[0]) && !tokens.some((t) => MUTATING.has(t));
};

const input = await readInput();
try {
  const root = findRoot(input.cwd || process.cwd()) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);
  const name = String(input.tool_name || '');
  const tool = name.split('__').slice(2).join('__') || name;
  if (isReadOnlyName(tool)) process.exit(0);
  const allowList = loadConfig(root).mcpAllow || [];
  if (allowList.some((re) => new RegExp(re).test(name))) process.exit(0);
  block(`MCP ツール ${name} は、ゲートの判定を通らない変更ができるため、許可されていません。`, '必要なら、人間に .ai-dev/config.json の mcpAllow への登録を依頼してください。');
} catch (e) {
  block(`ガードの内部エラーのため止めました: ${e.message}`);
}
