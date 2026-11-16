// PostToolUse: Write / Edit / MultiEdit / NotebookEdit / Bash / PowerShell（settings.json の matcher と同じ。シェルからの書き込みも作成者として記録する）
// 1. 誰がどのファイルを書いたかを記録する（相互レビューで「作成者 ≠ レビュアー」を照合するため）
// 2. 編集した製品コード・テストに Prettier と ESLint をかけ、問題があれば先頭数件だけを返す
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readInput } from './_io.mjs';
import { findRoot, toRel } from '../../scripts/lib/util.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { recordActivity } from '../../scripts/lib/review-evidence.mjs';
import { commandWriteTargets } from '../../scripts/lib/policy.mjs';

const input = await readInput();
try {
  // シェルからの書き込みも作成者として記録する（相互レビューの「作成者 ≠ レビュアー」の照合のため）
  if (['Bash', 'PowerShell'].includes(input.tool_name)) {
    const cwd = input.cwd || process.cwd();
    const root = findRoot(cwd);
    if (root && input.tool_input?.command) {
      const state = deriveState(root);
      for (const abs of commandWriteTargets(input.tool_input.command, cwd)) {
        const rel = toRel(root, abs);
        if (rel) recordActivity({ root, state, input, rel });
      }
    }
    process.exit(0);
  }
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!file) process.exit(0);
  const abs = path.resolve(input.cwd || process.cwd(), file);
  const root = findRoot(abs);
  if (!root) process.exit(0);
  const rel = toRel(root, abs);
  if (!rel) process.exit(0);

  try {
    recordActivity({ root, state: deriveState(root), input, rel });
  } catch {
    /* 記録の失敗で作業を止めない */
  }

  if (!/^(src|e2e)\/.+\.(ts|tsx|js|jsx|mjs|css|json)$/.test(rel)) process.exit(0);

  const bin = (name) => {
    const p = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
    return fs.existsSync(p) ? p : null;
  };
  const run = (cmd, args) => spawnSync(`"${cmd}"`, args.map((a) => `"${a}"`), { cwd: root, shell: true, encoding: 'utf8', timeout: 60000 });

  const prettier = bin('prettier');
  if (prettier) run(prettier, ['--write', '--log-level', 'warn', rel]);

  const eslint = bin('eslint');
  if (eslint && /\.(ts|tsx|js|jsx|mjs)$/.test(rel)) {
    const r = run(eslint, ['--format', 'unix', rel]);
    if (r.status && r.status !== 0) {
      const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l.includes(':')).slice(0, 8);
      process.stderr.write(`[LINT] ${rel} に ESLint の指摘があります（先頭 ${lines.length} 件）:\n${lines.join('\n')}\n`);
      process.exit(2);
    }
  }
} catch {
  /* 整形の失敗で作業を止めない */
}
process.exit(0);
