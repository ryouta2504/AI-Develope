// 状態の表示用テキスト（status コマンドとフックで共用）
import { currentBranch } from './util.mjs';
import { deriveState, nextAction } from './state.mjs';
import { loadConfig, REVIEWS } from './config.mjs';
import { debtSummary } from './debt.mjs';

/** レビュー番号と必須の観点（SSOT は config の reviewPerspectives。文書には写さず、これで確認する） */
export function perspectiveLines(root) {
  const config = loadConfig(root);
  const lines = ['レビュー番号と必須の観点（reviewer への依頼文の「観点:」にこの文字列のまま書く）:'];
  for (const [rv, def] of Object.entries(REVIEWS)) {
    const when = def.phases ? `${def.phases.join(' / ')} フェーズ` : 'メンテナンスモード中か feature/* ブランチ';
    lines.push(`  ${rv}（${def.label}・${when}）: ${(config.reviewPerspectives[rv] || []).join(' / ')}`);
  }
  return lines;
}

export function statusLines(root, { brief = false } = {}) {
  const s = deriveState(root);
  const branch = currentBranch(root);
  const mark = (st) => (st.valid ? '✅' : st.record?.status === 'rejected' ? '↩' : st.record?.status === 'invalidated' ? '✖' : st.record ? '⚠' : '・');
  const gates = s.steps.length ? s.steps.map((st) => `${st.id}${mark(st)}`).join(' ') : `G0${s.g0.valid ? '✅' : '・'}`;
  const head = `[AI-DEV] ${s.cycle || '(サイクルなし)'} phase=${s.phase} branch=${branch}${s.maintenance ? ' 🔧メンテナンス中' : ''}`;
  const debt = debtSummary(root, loadConfig(root).debtThreshold);
  const debtLine = debt.open.length ? `技術的負債: 未解消 ${debt.open.length} 件（重大度「高」${debt.high} 件）${debt.needsRefactor ? ' → PM は /refactor でリファクタリングサイクルを人間に提案する' : ''}` : null;
  if (brief) return [head, `ゲート: ${gates}`, `次: ${nextAction(s)}`, ...(debtLine ? [debtLine] : [])];
  const lines = [head, '', 'ゲート（✅ 通過 / ↩ 差し戻し / ✖ 無効 / ⚠ 記録後に変更あり / ・ 未）:'];
  lines.push(`  G0 開発計画: ${s.g0.valid ? '✅' : s.g0.record?.status === 'rejected' ? '↩' : '・'}`);
  for (const st of s.steps) {
    const extra = st.record?.status === 'rejected' || st.record?.status === 'invalidated' ? ` 理由: ${st.record.reason}` : st.stale.length && st.record ? ` 変更: ${st.stale.slice(0, 3).join(', ')}` : '';
    lines.push(`  ${mark(st)} ${st.id.padEnd(13)} (${st.kind === 'human' ? '人間' : '自動'})${st.record ? ` ${st.record.at.slice(0, 16)} ${st.record.by}` : ''}${extra}`);
  }
  lines.push('', `次にやること: ${nextAction(s)}`);
  if (debtLine) lines.push(debtLine);
  return lines;
}

