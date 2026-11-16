// PreToolUse: Bash / PowerShell
import fs from 'node:fs';
import path from 'node:path';
import { readInput, block } from './_io.mjs';
import { findRoot } from '../../scripts/lib/util.mjs';
import { checkBash } from '../../scripts/lib/policy.mjs';

const input = await readInput();
try {
  const command = input.tool_input?.command;
  if (!command) process.exit(0);
  const cwd = input.cwd || process.cwd();
  const root = findRoot(cwd) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);
  const r = checkBash({ root, command, cwd, agentType: input.agent_type });
  if (!r.allow) block(r.reason, r.hint);
  process.exit(0);
} catch (e) {
  block(`ガードの内部エラーのためコマンドを止めました: ${e.message}`, '人間に .claude/hooks と scripts/lib の確認を依頼してください。');
}
