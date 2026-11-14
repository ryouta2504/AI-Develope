// テスト用: 一時プロジェクトを作り、任意のフェーズまで進める
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeArtifacts, writeRecord } from '../../scripts/lib/state.mjs';
import { artifactPaths } from '../../scripts/lib/config.mjs';

export const CYCLE = 'C-001-test';

export function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

export function makeProject({ branch = 'cycle/C-001-test' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-test-'));
  write(root, 'package.json', JSON.stringify({ name: 't', type: 'module', scripts: { test: 'vitest run' }, dependencies: {} }, null, 2));
  write(root, '.ai-dev/config.json', JSON.stringify({ commands: { test: 'node -e "process.exit(1)"', testReport: '', lint: 'node -e ""', typecheck: 'node -e ""' } }));
  write(root, '.ai-dev/current.json', JSON.stringify({ cycle: null }));
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: root });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
  return root;
}

function record(root, cycle, step, status = undefined) {
  const human = ['G0', 'G1', 'G2', 'G3'].includes(step);
  writeRecord(root, cycle, step, {
    step,
    status: status || (human ? 'approved' : 'passed'),
    at: new Date().toISOString(),
    by: 'tester',
    artifacts: computeArtifacts(root, cycle, step),
    reason: status === 'rejected' ? 'テスト用の差し戻し' : undefined,
  });
}

export const REQ_DOC = `# 要求定義: テスト

### REQ-001: タスクを追加できる
- 優先度: Must
- 受入基準:
  - AC-001-1: 入力して追加ボタンを押すと一覧に表示される
`;
export const DESIGN_DOC = `# 設計

| ID | 名称 | 対応要求 |
|---|---|---|
| DES-001 | 追加フォーム | REQ-001 |

| WP | 名称 | 所有パス | 依存 | 設計 |
|---|---|---|---|---|
| WP-01 | 追加 | src/features/add/** | - | DES-001 |
| WP-02 | 一覧 | src/features/list/** | WP-01 | DES-001 |
`;
export const TESTPLAN_DOC = `# テスト計画

| TC | 対応 | 内容 |
|---|---|---|
| TC-001 | AC-001-1 | 追加すると一覧に出る |
`;
export const REVIEW_OK = `# レビュー

| 指摘 ID | 重大度 | 観点 | 対象 | 内容 | 状態 | 対応 |
|---|---|---|---|---|---|---|
| RV-01-001 | Minor | 表現 | REQ-001 | 言い回し | 未対応 | - |
`;

/** 指定フェーズになるまで成果物と記録を作る */
export function toPhase(root, phase) {
  write(root, 'docs/plan.md', '# 計画\n');
  record(root, null, 'G0');
  if (phase === 'idle') return;
  write(root, '.ai-dev/current.json', JSON.stringify({ cycle: CYCLE }));
  const a = artifactPaths(CYCLE);
  write(root, a.req, REQ_DOC);
  if (phase === 'requirements') return;
  write(root, a.rvReq, REVIEW_OK);
  record(root, CYCLE, 'REQ_REVIEW');
  record(root, CYCLE, 'G1');
  if (phase === 'design') return;
  write(root, a.design, DESIGN_DOC);
  write(root, a.rvDesign, REVIEW_OK.replace('RV-01-001', 'RV-02-001'));
  record(root, CYCLE, 'DESIGN_REVIEW');
  record(root, CYCLE, 'G2');
  if (phase === 'test_design') return;
  write(root, a.testPlan, TESTPLAN_DOC);
  write(root, a.rvTest, REVIEW_OK.replace('RV-01-001', 'RV-03-001'));
  write(root, 'src/features/add/AddForm.test.tsx', "it('[TC-001][AC-001-1] 追加', () => {})\n");
  record(root, CYCLE, 'RED');
  if (phase === 'implementation') return;
  write(root, 'src/features/add/AddForm.tsx', 'export const AddForm = () => null;\n');
  record(root, CYCLE, 'GREEN');
  if (phase === 'ai_review') return;
  write(root, a.rvCode, REVIEW_OK.replace('RV-01-001', 'RV-05-001'));
  record(root, CYCLE, 'CODE_REVIEW');
  if (phase === 'final_review') return;
  record(root, CYCLE, 'G3');
}

export { record };
export const abs = (root, rel) => path.join(root, rel);
