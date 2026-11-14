#!/usr/bin/env node
// テンプレートのメンテナンスモード: npm run maintenance -- on [時間] / off
// 有効な間だけ、メインセッションがテンプレートのファイル（.claude/、scripts/、README など）を変更できる。
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, writeJSON, nowIso } from './lib/util.mjs';
import { appendHistory } from './lib/state.mjs';
import { requireHuman, ask, whoAmI } from './lib/human.mjs';

requireHuman();
const root = findRoot(process.cwd());
const [mode, hoursArg] = process.argv.slice(2);
const file = path.join(root, '.ai-dev', 'maintenance.json');

if (mode === 'on') {
  const hours = Math.min(Number(hoursArg) || 2, 8);
  const reason = await ask('メンテナンスの目的（必須）: ');
  if (!reason) process.exit(1);
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  writeJSON(file, { by: whoAmI(root), at: nowIso(), until, reason });
  appendHistory(root, null, { type: 'maintenance_on', until, reason, by: whoAmI(root) });
  console.log(`🔧 メンテナンスモードを有効にしました（${until} まで）。`);
  console.log('   ※ フックの設定（.claude/settings.json）の変更は、Claude Code の再起動後に反映されます。');
} else if (mode === 'off') {
  fs.rmSync(file, { force: true });
  appendHistory(root, null, { type: 'maintenance_off', by: whoAmI(root) });
  console.log('🔒 メンテナンスモードを終了しました。');
} else {
  console.error('使い方: npm run maintenance -- on [時間(最大8)] / off');
  process.exit(2);
}
