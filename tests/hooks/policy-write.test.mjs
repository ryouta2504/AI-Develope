// 書き込みガード（checkWrite）のテスト: フェーズ × 役割 × パス
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkWrite } from '../../scripts/lib/policy.mjs';
import { makeProject, toPhase, write, abs, CYCLE } from './helpers.mjs';

const D = `docs/cycles/${CYCLE}`;
const can = (root, rel, agentType, extra = {}) => checkWrite({ root, absPath: abs(root, rel), agentType, branch: extra.branch ?? `cycle/${CYCLE}`, ...extra });
const ok = (r, msg) => assert.equal(r.allow, true, `${msg}: 許可されるべき（理由: ${r.reason}）`);
const ng = (r, msg) => assert.equal(r.allow, false, `${msg}: ブロックされるべき`);

describe('常に保護される領域', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  test('.ai-dev は誰も書けない', () => {
    ng(can(root, '.ai-dev/current.json'), 'メイン');
    ng(can(root, `.ai-dev/cycles/${CYCLE}/approvals/G1.json`, 'implementer'), 'implementer');
  });
  test('基盤ファイルは書けない', () => {
    for (const f of ['.claude/settings.json', '.claude/hooks/guard-write.mjs', 'scripts/gate.mjs', 'CLAUDE.md', '.github/workflows/quality-gate.yml', 'tests/hooks/x.test.mjs', '.claude/agents/pm.md']) {
      ng(can(root, f), f);
    }
  });
  test('メンテナンス中はメインだけが基盤ファイルを書ける', () => {
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() + 3600_000).toISOString() }));
    ok(can(root, 'scripts/gate.mjs'), 'メイン');
    ng(can(root, 'scripts/gate.mjs', 'implementer'), 'サブエージェント');
    ng(can(root, '.ai-dev/current.json'), 'メンテナンス中でも .ai-dev は不可');
    write(root, '.ai-dev/maintenance.json', JSON.stringify({ until: new Date(Date.now() - 1000).toISOString() }));
    ng(can(root, 'scripts/gate.mjs'), '期限切れ');
  });
  test('自動生成ファイル・他サイクルの記録は書けない', () => {
    ng(can(root, `${D}/traceability.md`, 'review-aggregator'), 'traceability');
    ng(can(root, 'docs/cycles/C-000-old/01_requirements.md', 'requirements'), '過去サイクル');
  });
  test('役割のない汎用エージェントは何も書けない', () => {
    ng(can(root, 'src/features/add/x.test.ts', 'general-purpose'), 'general-purpose');
    ng(can(root, 'notes.txt', 'general-purpose'), '未分類パスも不可');
  });
  test('docs/memo と tasks はフェーズに関係なく書ける', () => {
    ok(can(root, 'docs/memo/a.md'), 'memo');
    ok(can(root, `${D}/tasks/T-001.md`), 'tasks');
  });
});

describe('planning（G0 前）', () => {
  const root = makeProject();
  test('PM は計画を書ける', () => ok(can(root, 'docs/plan.md'), 'plan'));
  test('コードは書けない', () => ng(can(root, 'src/App.tsx', 'implementer'), 'src'));
});

describe('requirements', () => {
  const root = makeProject();
  toPhase(root, 'requirements');
  test('requirements エージェントは要求定義を書ける', () => ok(can(root, `${D}/01_requirements.md`, 'requirements'), '01'));
  test('PM は要求定義を直接書けない', () => ng(can(root, `${D}/01_requirements.md`), 'PM'));
  test('architect は要求定義を書けない（役割）', () => ng(can(root, `${D}/01_requirements.md`, 'architect'), 'architect'));
  test('設計書はまだ書けない（フェーズ）', () => ng(can(root, `${D}/02_design.md`, 'architect'), '02'));
  test('review-aggregator はレビュー記録を書ける', () => ok(can(root, `${D}/reviews/RV-01_requirements.md`, 'review-aggregator'), 'RV-01'));
  test('reviewer は何も書けない', () => ng(can(root, `${D}/reviews/RV-01_requirements.md`, 'reviewer'), 'reviewer'));
  test('サイクル内の未定義パスは書けない', () => ng(can(root, `${D}/random.md`, 'requirements'), 'random'));
});

describe('design', () => {
  const root = makeProject();
  toPhase(root, 'design');
  test('architect は設計書を書ける', () => ok(can(root, `${D}/02_design.md`, 'architect'), '02'));
  test('承認済みの要求定義は凍結される', () => ng(can(root, `${D}/01_requirements.md`, 'requirements'), '01'));
  test('src はまだ書けない', () => ng(can(root, 'src/features/add/AddForm.test.tsx', 'test-designer'), 'test'));
});

describe('test_design', () => {
  const root = makeProject();
  toPhase(root, 'test_design');
  test('test-designer はテスト・設定・テスト計画を書ける', () => {
    ok(can(root, 'src/features/add/AddForm.test.tsx', 'test-designer'), 'test');
    ok(can(root, 'vitest.config.ts', 'test-designer'), 'config');
    ok(can(root, `${D}/03_test_plan.md`, 'test-designer'), '03');
  });
  test('製品コードはまだ書けない（テストが先）', () => ng(can(root, 'src/features/add/AddForm.tsx', 'implementer'), 'product'));
  test('implementer はテスト計画を書けない', () => ng(can(root, `${D}/03_test_plan.md`, 'implementer'), '03'));
  test('.skip / .only は使えない', () => {
    ng(can(root, 'src/a.test.ts', 'test-designer', { addedText: "it.skip('x', () => {})" }), 'skip');
    ng(can(root, 'src/a.test.ts', 'test-designer', { addedText: "describe.only('x', () => {})" }), 'only');
    ok(can(root, 'src/a.test.ts', 'test-designer', { addedText: "it('[TC-001] x', () => {})" }), '通常');
  });
});

describe('implementation', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  test('テストのある製品コードは書ける', () => ok(can(root, 'src/features/add/AddForm.tsx', 'implementer'), 'AddForm'));
  test('テストのない製品コードは書けない（TDD）', () => ng(can(root, 'src/features/add/Other.tsx', 'implementer'), 'Other'));
  test('TDD 除外ファイルは書ける', () => {
    ok(can(root, 'src/main.tsx', 'implementer'), 'main');
    ok(can(root, 'src/features/add/index.ts', 'implementer'), 'index');
    ok(can(root, 'src/features/add/style.css', 'implementer'), 'css');
  });
  test('ロック済みのテストは書き換えられない', () => ng(can(root, 'src/features/add/AddForm.test.tsx', 'implementer'), 'locked'));
  test('新しいテストは追加できる', () => ok(can(root, 'src/features/add/Extra.test.tsx', 'implementer'), 'new test'));
  test('PM は製品コードを書けない', () => ng(can(root, 'src/features/add/AddForm.tsx'), 'PM'));
  test('test-designer は製品コードを書けない', () => ng(can(root, 'src/features/add/AddForm.tsx', 'test-designer'), 'test-designer'));
  test('テスト・ビルド設定はロック後は書けない', () => ng(can(root, 'vitest.config.ts', 'test-designer'), 'config'));
  test('WP ブランチでは所有パスの外を書けない', () => {
    write(root, 'src/features/list/List.test.tsx', 'x');
    ng(can(root, 'src/features/list/List.tsx', 'implementer', { branch: 'wp/C-001/WP-01' }), 'WP-01 から list');
    ok(can(root, 'src/features/add/AddForm.tsx', 'implementer', { branch: 'wp/C-001/WP-01' }), 'WP-01 から add');
  });
});

describe('package.json', () => {
  const root = makeProject();
  toPhase(root, 'implementation');
  const pkg = JSON.parse('{"name":"t","type":"module","scripts":{"test":"vitest run"},"dependencies":{}}');
  test('依存の追加は implementer ならできる', () => {
    ok(can(root, 'package.json', 'implementer', { newText: JSON.stringify({ ...pkg, dependencies: { react: '^19.0.0' } }) }), 'deps');
  });
  test('scripts は変更できない', () => {
    ng(can(root, 'package.json', 'implementer', { newText: JSON.stringify({ ...pkg, scripts: { test: 'echo ok' } }) }), 'scripts');
  });
  test('PM は変更できない', () => {
    ng(can(root, 'package.json', undefined, { newText: JSON.stringify({ ...pkg, dependencies: { a: '1' } }) }), 'PM');
  });
});

describe('final_review / done', () => {
  const root = makeProject();
  toPhase(root, 'final_review');
  test('最終レビュー中は AI はコードもレビュー記録も書けない', () => {
    ng(can(root, 'src/features/add/AddForm.tsx', 'implementer'), 'src');
    ng(can(root, `${D}/reviews/RV-05_code.md`, 'review-aggregator'), 'RV-05');
  });
});
