#!/usr/bin/env node
// 状態表示: npm run status [-- --brief]
import { findRoot } from './lib/util.mjs';
import { statusLines } from './lib/statusview.mjs';

const root = findRoot(process.cwd());
if (!root) {
  console.error('プロジェクトルート（.ai-dev）が見つかりません');
  process.exit(1);
}
console.log(statusLines(root, { brief: process.argv.includes('--brief') }).join('\n'));
