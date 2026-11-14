// コマンド実行と出力の要約（コンテキストを汚さないよう、失敗時も先頭数行だけ返す）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listFiles } from './util.mjs';

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

/**
 * GREEN のチェック一式を実行する（gate / stop-gate / CI で共用）
 * - report: true なら test の代わりに testReport（TC ごとの結果を JSON に残す）を使う
 * - e2e は e2e/ にファイルがあるときだけ実行する
 */
export function runGreen(root, config, { report = false, timeoutMs } = {}) {
  if (report) {
    fs.mkdirSync(path.join(root, '.ai-dev', '.cache'), { recursive: true });
    for (const f of ['test-results.json', 'e2e-results.json']) fs.rmSync(path.join(root, '.ai-dev', '.cache', f), { force: true });
  }
  const results = [];
  for (const name of config.green) {
    if (name === 'e2e' && listFiles(root, 'e2e').length === 0) continue;
    const key = name === 'test' && report && config.commands.testReport ? 'testReport' : name;
    const cmd = config.commands[key];
    if (!cmd) continue;
    results.push({ name, ...runCommand(root, cmd, { timeoutMs }) });
  }
  return { results, failed: results.filter((r) => r.code !== 0) };
}
