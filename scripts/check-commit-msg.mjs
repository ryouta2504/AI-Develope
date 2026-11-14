#!/usr/bin/env node
// git の commit-msg フックから呼ばれる。CI では --range <base>..<head> で一括検証する。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkCommitMessage } from './lib/commitmsg.mjs';

const args = process.argv.slice(2);
if (args[0] === '--range') {
  const log = execFileSync('git', ['log', args[1], '--format=%h%x00%B%x1e'], { encoding: 'utf8' });
  let bad = 0;
  for (const entry of log.split('\x1e')) {
    const [hash, body] = entry.trim().split('\x00');
    if (!hash) continue;
    const p = checkCommitMessage(body || '');
    if (p.length) {
      bad++;
      console.error(`❌ ${hash}: ${(body || '').split('\n')[0]}`);
      for (const x of p) console.error(`   - ${x}`);
    }
  }
  if (bad) process.exit(1);
  console.log('✅ コミットメッセージ規約 OK');
} else {
  const msg = fs.readFileSync(args[0], 'utf8');
  const p = checkCommitMessage(msg);
  if (p.length) {
    console.error('❌ コミットメッセージが規約に合っていません:');
    for (const x of p) console.error(`   - ${x}`);
    console.error('   例: feat(C-001): タスクを追加できるようにする\n\n       Refs: REQ-001, AC-001-1, TC-001');
    process.exit(1);
  }
}
