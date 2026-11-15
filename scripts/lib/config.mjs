// テンプレートの設定とパス分類（SSOT: パスの分類・レビューの種類はここだけで定義する）
import path from 'node:path';
import { readJSON, matchAny } from './util.mjs';

export const DEFAULT_CONFIG = {
  // 自動ゲートで実行するコマンド（スタックを変えるときは .ai-dev/config.json で上書きする）
  commands: {
    test: 'npm run test --silent',
    // GREEN 判定時に使うテストコマンド（TC ごとの結果を JSON で残す。空なら test を使う）
    testReport: 'npx vitest run --reporter=default --reporter=json --outputFile.json=.ai-dev/.cache/test-results.json',
    lint: 'npm run lint --silent',
    typecheck: 'npm run typecheck --silent',
    build: 'npm run build --silent',
    // E2E。playwright.config で json レポーターの出力先を .ai-dev/.cache/e2e-results.json にする（react-testing スキル参照）
    e2e: 'npm run e2e --silent',
    // RED 再判定時に、変更したテストファイルだけを実行するコマンド（{files} に置換）
    testFiles: 'npx vitest run {files}',
  },
  // GREEN で実行するコマンド。e2e は e2e/ にテストがあるときだけ実行する
  green: ['test', 'lint', 'typecheck', 'build', 'e2e'],
  maxStopBlocks: 3,
  // メインセッション（PM）によるコード編集を禁止するか
  enforcePmNoCode: true,
  // 役割（agent_type）ごとの書き込み権限を強制するか
  enforceRoles: true,
  // 相互レビューの実施記録をゲートで照合するか
  requireReviewEvidence: true,
  // レビューごとに必須の観点（reviewer への依頼文の「観点:」はこの中から選ぶ）
  reviewPerspectives: {
    'RV-01': ['曖昧さ・テスト可能性', '実現可能性'],
    'RV-02': ['要求との整合', 'テストしやすさ', '保守性'],
    'RV-03': ['受入基準の網羅', 'テストの甘さ'],
    'RV-05': ['要求適合', 'セキュリティ', 'アクセシビリティ・UX', '保守性'],
    'RV-PF': ['ガードの抜け穴', 'ロジックの正しさ', 'ドキュメントとの整合', '保守性'],
  },
  // 使ってよい MCP ツール（名前の正規表現）。それ以外の MCP ツールで書き込み系のものはブロックする
  mcpAllow: [],
};

export function loadConfig(root) {
  const user = readJSON(path.join(root, '.ai-dev', 'config.json'), {});
  return {
    ...DEFAULT_CONFIG,
    ...user,
    commands: { ...DEFAULT_CONFIG.commands, ...(user.commands || {}) },
    reviewPerspectives: { ...DEFAULT_CONFIG.reviewPerspectives, ...(user.reviewPerspectives || {}) },
  };
}

/**
 * レビューの種類（SSOT）
 *  phases: 依頼できるフェーズ（null = フェーズではなく、メンテナンスモード中か feature/* ブランチ）
 *  doc:    指摘表（artifactPaths のキー。RV-PF はブランチごと）
 *  gate:   照合する自動ゲート
 */
export const REVIEWS = {
  'RV-01': { phases: ['requirements'], doc: 'rvReq', gate: 'REQ_REVIEW', label: '要求定義' },
  'RV-02': { phases: ['design'], doc: 'rvDesign', gate: 'DESIGN_REVIEW', label: '設計' },
  'RV-03': { phases: ['test_design'], doc: 'rvTest', gate: 'RED', label: 'テスト' },
  'RV-05': { phases: ['implementation', 'ai_review'], doc: 'rvCode', gate: 'CODE_REVIEW', label: 'コード' },
  'RV-PF': { phases: null, doc: null, gate: 'PLATFORM_REVIEW', label: 'テンプレート' },
};
export const RV_ID = /RV-(\d{2}|PF)/;

/** 人間だけが変更できる領域（メンテナンスモードでも AI は書けない） */
export const HUMAN_ONLY = ['.ai-dev/**', '.git/**'];

/** テンプレートそのもの（ゲートの仕組み・その基準となる文書・ツールの設定）。メンテナンスモード中だけメインセッションが変更できる */
export const PLATFORM = [
  '.claude/**',
  'scripts/**',
  '.githooks/**',
  '.github/**',
  'tests/hooks/**',
  'docs/templates/**',
  'docs/GETTING_STARTED.md',
  'docs/memo/00_setup_prompt.md',
  'docs/memo/01_platform_design.md',
  'CLAUDE.md',
  'README.md',
  '.gitattributes',
  '.gitignore',
  // パッケージマネージャ・エディタ・MCP の設定（スクリプト実行やツールの挙動を変えられるため）
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.mcp.json',
  '.vscode/**',
  '.devcontainer/**',
];

/** テンプレートのファイルか（package.json と .ai-dev/config.json も含む） */
export const isPlatformFile = (rel) => matchAny(rel, PLATFORM) || rel === 'package.json' || rel === '.ai-dev/config.json';

/** テストファイル */
export const TEST_FILES = ['src/**/*.test.*', 'src/**/*.spec.*', 'src/**/__tests__/**', 'e2e/**'];
export const isTestFile = (rel) => matchAny(rel, TEST_FILES);

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

/**
 * 対応するテストがなくてもよい製品ファイル（TDD チェックの除外）。
 * index.ts / types.ts は中身も検査する（再エクスポート・型定義だけなら可）: policy.mjs の scaffoldContentProblem
 */
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
];

/** フェーズに関係なく書き込める場所（メインセッション用。レビュー記録だけは review-aggregator も書ける） */
export const FREE_FILES = ['docs/memo/**'];
export const PLATFORM_REVIEW_DIR = 'docs/memo/reviews';

/** 実行可能なスクリプトの拡張子（未分類の場所には誰も置けない: 任意コードの実行経路になるため） */
export const SCRIPT_EXT = /\.(m?js|cjs|ts|mts|cts|jsx|tsx|py|ps1|psm1|sh|bash|bat|cmd|vbs)$/i;

/** レビューに渡してはいけない入力（作業の経緯・過去のレビュー・状態） */
export const FORBIDDEN_REVIEW_INPUTS = ['.ai-dev/**', 'docs/cycles/*/tasks/**', 'docs/cycles/*/reviews/**', 'docs/cycles/*/retro.md', 'docs/memo/reviews/**', 'docs/improvements.md'];

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
/** 振り返りなどから出た改善候補（未承認）。承認済みのバックログは docs/plan.md（G0）にだけある */
export const IMPROVEMENTS_FILE = 'docs/improvements.md';
