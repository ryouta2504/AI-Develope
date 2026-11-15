// PreToolUse: Write / Edit / MultiEdit / NotebookEdit
// 判定は scripts/lib/policy.mjs の checkWrite に任せる（ここは入力の整形だけ）
import fs from 'node:fs';
import path from 'node:path';
import { readInput, block } from './_io.mjs';
import { findRoot } from '../../scripts/lib/util.mjs';
import { checkWrite } from '../../scripts/lib/policy.mjs';

const input = await readInput();
try {
  const ti = input.tool_input || {};
  const file = ti.file_path || ti.notebook_path;
  if (!file) process.exit(0);
  const abs = path.resolve(input.cwd || process.cwd(), file);
  const root = findRoot(abs) || findRoot(input.cwd) || process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(path.join(root, '.ai-dev'))) process.exit(0);

  let newText;
  let addedText;
  const current = () => {
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return '';
    }
  };
  switch (input.tool_name) {
    case 'Write':
      newText = ti.content ?? '';
      addedText = newText;
      break;
    case 'Edit':
      newText = ti.replace_all ? current().split(ti.old_string).join(ti.new_string) : current().replace(ti.old_string, () => ti.new_string); // 関数で置換する（new_string の $& や $1 が特殊文字として解釈されないように）
      addedText = ti.new_string;
      break;
    case 'MultiEdit': {
      let t = current();
      for (const e of ti.edits || []) t = e.replace_all ? t.split(e.old_string).join(e.new_string) : t.replace(e.old_string, () => e.new_string);
      newText = t;
      addedText = (ti.edits || []).map((e) => e.new_string).join('\n');
      break;
    }
    case 'NotebookEdit':
      addedText = ti.new_source;
      break;
  }
  const r = checkWrite({ root, absPath: abs, agentType: input.agent_type, newText, addedText });
  if (!r.allow) block(r.reason, r.hint);
  process.exit(0);
} catch (e) {
  // 判定できないときは安全側（ブロック）に倒す
  block(`ガードの内部エラーのため書き込みを止めました: ${e.message}`, '人間に .claude/hooks と scripts/lib の確認を依頼してください。');
}
