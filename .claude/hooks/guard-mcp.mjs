// PreToolUse: mcp__.*（MCP サーバーのツール）
// MCP ツールはファイル書き込みや外部サービスの変更ができるため、フックの判定を迂回しうる。
// 読み取り系（get / list / read / search / query など）は許可し、それ以外は .ai-dev/config.json の mcpAllow に
// 人間が登録したものだけを許可する。
import fs from 'node:fs';
import path from 'node:path';
import { readInput, block } from './_io.mjs';
import { findRoot } from '../../scripts/lib/util.mjs';
import { loadConfig } from '../../scripts/lib/config.mjs';

const READ_ONLY = /(^|__|_)(get|list|read|search|query|fetch|find|describe|view|show|status|guide)([_A-Z]|$)/i;

const input = await readInput();
try {
  const root = findRoot(input.cwd || process.cwd()) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);
  const name = String(input.tool_name || '');
  const tool = name.split('__').slice(2).join('__') || name;
  if (READ_ONLY.test(tool)) process.exit(0);
  const allowList = loadConfig(root).mcpAllow || [];
  if (allowList.some((re) => new RegExp(re).test(name))) process.exit(0);
  block(`MCP ツール ${name} は、ゲートの判定を通らない変更ができるため、許可されていません。`, '必要なら、人間に .ai-dev/config.json の mcpAllow への登録を依頼してください。');
} catch (e) {
  block(`ガードの内部エラーのため止めました: ${e.message}`);
}
