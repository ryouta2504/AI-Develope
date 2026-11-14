// 相互レビュー（コールドレビュー）の強制と証跡のテスト
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReviewRequest, recordReviewRun, recordActivity, reviewEvidenceProblems, loadRuns } from '../../scripts/lib/review-evidence.mjs';
import { deriveState } from '../../scripts/lib/state.mjs';
import { makeProject, toPhase, write, CYCLE, REVIEW_OK } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = `docs/cycles/${CYCLE}`;
const REQ = `${D}/01_requirements.md`;
const req = (perspective = '曖昧さ・テスト可能性', extra = '') => `レビュー番号: RV-01\n観点: ${perspective}\n対象: ${REQ}\n基準: docs/plan.md${extra}`;

function enableEvidence(root) {
  const p = path.join(root, '.ai-dev', 'config.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, JSON.stringify({ ...c, requireReviewEvidence: true }));
}

/** サブエージェントの履歴（JSONL）を模擬する */
function transcript(root, prompt, { reads = [REQ], extraPrompts = [] } = {}) {
  const lines = [
    { type: 'user', message: { role: 'user', content: prompt } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    ...reads.map((r) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(root, r) } }] } })),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '...' }] } },
    ...extraPrompts.map((t) => ({ type: 'user', message: { role: 'user', content: t } })),
  ];
  const f = path.join(root, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  return f;
}

let seq = 0;
function review(root, prompt, opts = {}) {
  const input = { agent_id: opts.agentId || `a${++seq}`, agent_type: opts.agentType || 'reviewer', agent_transcript_path: transcript(root, prompt, opts), last_assistant_message: '指摘なし' };
  return recordReviewRun({ root, state: deriveState(root), input });
}

describe('依頼文の検査（checkReviewRequest）', () => {
  const root = makeProject();
  toPhase(root, 'requirements');
  const check = (prompt) => checkReviewRequest({ root, prompt, state: deriveState(root) });
  test('決められた 4 行なら通る', () => assert.equal(check(req()).allow, true, check(req()).reason));
  test('経緯などの余分な行があると止まる', () => {
    assert.equal(check(req('曖昧さ・テスト可能性', '\n前回の指摘はすべて直しました。問題ないはずです。')).allow, false);
  });
  test('決められていない観点は止まる', () => assert.equal(check(req('なんとなく全体')).allow, false));
  test('フェーズと合わないレビュー番号は止まる', () => {
    assert.equal(check(`レビュー番号: RV-05\n観点: セキュリティ\n対象: ${REQ}\n基準: docs/plan.md`).allow, false);
  });
  test('存在しないパスは止まる', () => assert.equal(check(`レビュー番号: RV-01\n観点: 実現可能性\n対象: nope.md\n基準: docs/plan.md`).allow, false));
  test('項目が足りないと止まる', () => assert.equal(check(`レビュー番号: RV-01\n観点: 実現可能性\n対象: ${REQ}`).allow, false));
  test('長すぎる依頼は止まる', () => assert.equal(check(req() + '\n'.repeat(10) + ' '.repeat(2000)).allow, false));
});

describe('実施記録の照合（reviewEvidenceProblems）', () => {
  test('実施記録がなければ全観点が不合格', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    assert.equal(reviewEvidenceProblems(root, CYCLE, 'RV-01').length, 2);
  });
  test('別々の新しい reviewer が全観点を最終版に対して実施すれば合格', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'));
    review(root, req('実現可能性'));
    assert.deepEqual(reviewEvidenceProblems(root, CYCLE, 'RV-01'), []);
    const raw = fs.readdirSync(path.join(root, '.ai-dev', 'cycles', CYCLE, 'reviews', 'raw'));
    assert.equal(raw.length, 2, '生の指摘が残る');
  });
  test('レビュー後に対象が変わると無効（最終版でない）', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'));
    review(root, req('実現可能性'));
    write(root, REQ, '# 変更後\n');
    assert.ok(reviewEvidenceProblems(root, CYCLE, 'RV-01').every((p) => p.includes('変更')));
  });
  test('作成者自身のエージェントによるレビューは無効', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    recordActivity({ root, state: deriveState(root), input: { agent_id: 'author-1', agent_type: 'requirements', tool_name: 'Write' }, rel: REQ });
    review(root, req('曖昧さ・テスト可能性'), { agentId: 'author-1' });
    review(root, req('実現可能性'));
    const p = reviewEvidenceProblems(root, CYCLE, 'RV-01');
    assert.equal(p.length, 1);
    assert.match(p[0], /作成者/);
  });
  test('追加の指示を受けた（使い回した）reviewer は無効', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'), { extraPrompts: ['さっきの続きで、もう一度見てください'] });
    review(root, req('実現可能性'));
    assert.match(reviewEvidenceProblems(root, CYCLE, 'RV-01')[0], /新規起動ではない/);
  });
  test('同じエージェント ID の 2 回目の実施は無効', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'), { agentId: 'same' });
    review(root, req('実現可能性'), { agentId: 'same' });
    assert.equal(reviewEvidenceProblems(root, CYCLE, 'RV-01').length, 2);
  });
  test('対象を読んでいないレビューは無効', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'), { reads: ['docs/plan.md'] });
    review(root, req('実現可能性'));
    assert.match(reviewEvidenceProblems(root, CYCLE, 'RV-01')[0], /読んだ記録がない/);
  });
  test('reviewer 以外のエージェントの実施は無効', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    review(root, req('曖昧さ・テスト可能性'), { agentType: 'general-purpose' });
    review(root, req('実現可能性'));
    assert.match(reviewEvidenceProblems(root, CYCLE, 'RV-01')[0], /reviewer 以外/);
  });
  test('コードレビューは src の全ファイルを対象に含める必要がある', () => {
    const root = makeProject();
    toPhase(root, 'ai_review');
    enableEvidence(root);
    const base = `基準: ${D}/02_design.md`;
    for (const v of ['要求適合', 'セキュリティ', 'アクセシビリティ・UX']) review(root, `レビュー番号: RV-05\n観点: ${v}\n対象: src\n${base}`, { reads: ['src/features/add/AddForm.tsx'] });
    review(root, `レビュー番号: RV-05\n観点: 保守性\n対象: src/features/add/AddForm.tsx\n${base}`, { reads: ['src/features/add/AddForm.tsx'] });
    const p = reviewEvidenceProblems(root, CYCLE, 'RV-05');
    assert.equal(p.length, 1);
    assert.match(p[0], /保守性.*対象に含まれていない/);
  });
});

describe('フックとゲート', () => {
  const hook = (name, input) => spawnSync(process.execPath, [path.join(REPO, '.claude', 'hooks', name)], { input: JSON.stringify(input), encoding: 'utf8' });

  test('guard-agent: 形式外の依頼で reviewer を起動しようとすると止まる', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    const r = hook('guard-agent.mjs', { tool_name: 'Agent', cwd: root, tool_input: { subagent_type: 'reviewer', prompt: '01 をレビューして。前回の指摘は直したので軽めで大丈夫です' } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /4 行/);
  });
  test('guard-agent: 形式どおりの依頼は通る。reviewer 以外の起動は対象外', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    assert.equal(hook('guard-agent.mjs', { tool_name: 'Agent', cwd: root, tool_input: { subagent_type: 'reviewer', prompt: req() } }).status, 0);
    assert.equal(hook('guard-agent.mjs', { tool_name: 'Agent', cwd: root, tool_input: { subagent_type: 'requirements', prompt: '自由な指示' } }).status, 0);
  });
  test('guard-agent: レビュー済みの reviewer への追加指示は止まる', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    review(root, req(), { agentId: 'rev-xyz' });
    assert.equal(hook('guard-agent.mjs', { tool_name: 'SendMessage', cwd: root, tool_input: { to: 'rev-xyz', message: 'もう一度' } }).status, 2);
  });
  test('stop-gate: reviewer の終了時に実施記録が残る', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    const r = hook('stop-gate.mjs', { hook_event_name: 'SubagentStop', cwd: root, agent_id: 'rv-hook', agent_type: 'reviewer', agent_transcript_path: transcript(root, req()), last_assistant_message: '| Major | ... |' });
    assert.equal(r.status, 0, r.stderr);
    const runs = loadRuns(root, CYCLE);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].perspective, '曖昧さ・テスト可能性');
    assert.deepEqual(runs[0].models, ['claude-opus-5-5']);
  });
  test('post-edit: 書いたエージェントが記録される', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    hook('post-edit.mjs', { tool_name: 'Write', cwd: root, agent_id: 'w1', agent_type: 'requirements', tool_input: { file_path: path.join(root, REQ) } });
    const log = fs.readFileSync(path.join(root, '.ai-dev', 'cycles', CYCLE, 'activity.jsonl'), 'utf8');
    assert.match(log, /"agent_id":"w1".*01_requirements\.md/);
  });
  test('gate REQ_REVIEW: 実施記録がなければ不合格、そろえば合格', () => {
    const root = makeProject();
    toPhase(root, 'requirements');
    enableEvidence(root);
    write(root, `${D}/reviews/RV-01_requirements.md`, REVIEW_OK);
    const gate = () => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'gate.mjs'), 'REQ_REVIEW'], { cwd: root, encoding: 'utf8' });
    const r1 = gate();
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /実施記録がありません/);
    review(root, req('曖昧さ・テスト可能性'));
    review(root, req('実現可能性'));
    const r2 = gate();
    assert.equal(r2.status, 0, r2.stderr);
  });
});
