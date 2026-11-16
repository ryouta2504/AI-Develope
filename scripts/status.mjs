#!/usr/bin/env node
// 状態表示: npm run status [-- --brief | --perspectives]
import { findRoot } from './lib/util.mjs';
import { statusLines, perspectiveLines } from './lib/statusview.mjs';

const root = findRoot(process.cwd());
if (!root) {
  console.error('プロジェクトルート（.ai-dev）が見つかりません');
  process.exit(1);
}
if (process.argv.includes('--perspectives')) console.log(perspectiveLines(root).join('\n'));
else console.log(statusLines(root, { brief: process.argv.includes('--brief') }).join('\n'));
