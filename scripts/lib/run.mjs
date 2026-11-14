// コマンド実行と出力の要約（コンテキストを汚さないよう、失敗時も先頭数行だけ返す）
import { spawnSync } from 'node:child_process';

export function runCommand(root, command, { timeoutMs = 600000 } = {}) {
  const started = Date.now();
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  return { command, code: r.status ?? (r.error ? 127 : 1), output, ms: Date.now() - started };
}

/** 失敗出力から重要そうな行だけを抜き出す */
export function summarize(output, maxLines = 12) {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const important = lines.filter((l) => /(FAIL|Error|error|✗|×|failed|AssertionError|Expected|Received|not found|Cannot|ERR!|warning)/.test(l));
  const pick = (important.length ? important : lines.slice(-maxLines)).slice(0, maxLines);
  return pick.map((l) => (l.length > 200 ? l.slice(0, 200) + '…' : l)).join('\n');
}
