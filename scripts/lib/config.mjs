// 基盤の設定とパス分類（SSOT: パスの分類はここだけで定義する）
import path from 'node:path';
import { readJSON } from './util.mjs';

export const DEFAULT_CONFIG = {
  // 自動ゲートで実行するコマンド（スタックを変えるときはここを変える）
  commands: {
    test: 'npm run test --silent',
    // GREEN 判定時に使うテストコマンド（TC ごとの結果を JSON で残す。空なら test を使う）
    testReport: 'npx vitest run --reporter=default --reporter=json --outputFile.json=.ai-dev/.cache/test-results.json',
    lint: 'npm run lint --silent',
    typecheck: 'npm run typecheck --silent',
    // RED 再判定時に、変更したテストファイルだけを実行するコマンド（{files} に置換）
    testFiles: 'npx vitest run {files}',
  },
  green: ['test', 'lint', 'typecheck'],
  maxStopBlocks: 3,
  // メインセッション（PM）によるコード編集を禁止するか
  enforcePmNoCode: true,
  // 役割（agent_type）ごとの書き込み権限を強制するか
  enforceRoles: true,
};

export function loadConfig(root) {
  const user = readJSON(path.join(root, '.ai-dev', 'config.json'), {});
  return {
    ...DEFAULT_CONFIG,
    ...user,
    commands: { ...DEFAULT_CONFIG.commands, ...(user.commands || {}) },
  };
}

/** 人間だけが変更できる領域（メンテナンスモードでも AI は書けない） */
export const HUMAN_ONLY = ['.ai-dev/**', '.git/**'];

/** 基盤そのもの。メンテナンスモード中だけ AI が変更できる */
export const PLATFORM = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks/**',
  '.claude/agents/**',
  '.claude/skills/**',
  '.claude/commands/**',
  'scripts/**',
  '.githooks/**',
  '.github/**',
  'tests/hooks/**',
  'docs/templates/**',
  'CLAUDE.md',
  '.gitattributes',
];

/** テストファイル */
export const TEST_FILES = ['src/**/*.test.*', 'src/**/*.spec.*', 'src/**/__tests__/**', 'e2e/**'];

/** テスト・ビルド設定（RED でロックする） */
export const CONFIG_FILES = [
  'vite.config.*',
  'vitest.config.*',
  'vitest.setup.*',
  'eslint.config.*',
  '.eslintrc*',
  'tsconfig*.json',
  'playwright.config.*',
  '.prettierrc*',
  'prettier.config.*',
  'src/test/setup.*',
];

/** 製品コード（テスト以外） */
export const PRODUCT_FILES = ['src/**', 'public/**', 'index.html'];

/** 対応するテストがなくてもよい製品ファイル（TDD チェックの除外） */
export const TDD_EXEMPT = [
  'src/main.*',
  'src/**/*.d.ts',
  'src/**/*.css',
  'src/**/*.scss',
  'src/**/*.svg',
  'src/**/*.png',
  'src/**/*.json',
  'src/**/index.ts',
  'src/**/types.ts',
  'src/**/*.types.ts',
  'src/test/**',
  'src/assets/**',
  'src/vite-env.d.ts',
];

/** フェーズに関係なく書き込める場所（役割の制限は別途かかる） */
export const FREE_FILES = ['docs/memo/**', 'README.md', '.gitignore'];

export const cycleDir = (cycleId) => `docs/cycles/${cycleId}`;

/** サイクル内の成果物パス */
export function artifactPaths(cycleId) {
  const d = cycleDir(cycleId);
  return {
    dir: d,
    req: `${d}/01_requirements.md`,
    design: `${d}/02_design.md`,
    testPlan: `${d}/03_test_plan.md`,
    rvReq: `${d}/reviews/RV-01_requirements.md`,
    rvDesign: `${d}/reviews/RV-02_design.md`,
    rvTest: `${d}/reviews/RV-03_tests.md`,
    rvCode: `${d}/reviews/RV-05_code.md`,
    trace: `${d}/traceability.md`,
    tasks: `${d}/tasks/**`,
    retro: `${d}/retro.md`,
  };
}

export const PLAN_FILE = 'docs/plan.md';
export const BACKLOG_FILE = 'docs/backlog.md';
