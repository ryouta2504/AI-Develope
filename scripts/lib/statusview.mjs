// 状態の表示用テキスト（status コマンドとフックで共用）
import { currentBranch } from './util.mjs';
import { deriveState, nextAction } from './state.mjs';

export function statusLines(root, { brief = false } = {}) {
  const s = deriveState(root);
  const branch = currentBranch(root);
  const mark = (st) => (st.valid ? '✅' : st.record?.status === 'rejected' ? '↩' : st.record ? '⚠' : '・');
  const gates = s.steps.length ? s.steps.map((st) => `${st.id}${mark(st)}`).join(' ') : `G0${s.g0.valid ? '✅' : '・'}`;
  const head = `[AI-DEV] ${s.cycle || '(サイクルなし)'} phase=${s.phase} branch=${branch}${s.maintenance ? ' 🔧メンテナンス中' : ''}`;
  if (brief) return [head, `ゲート: ${gates}`, `次: ${nextAction(s)}`];
  const lines = [head, '', 'ゲート（✅ 通過 / ↩ 差し戻し / ⚠ 記録後に変更あり / ・ 未）:'];
  lines.push(`  G0 開発計画: ${s.g0.valid ? '✅' : s.g0.record?.status === 'rejected' ? '↩' : '・'}`);
  for (const st of s.steps) {
    const extra = st.record?.status === 'rejected' ? ` 理由: ${st.record.reason}` : st.stale.length && st.record ? ` 変更: ${st.stale.slice(0, 3).join(', ')}` : '';
    lines.push(`  ${mark(st)} ${st.id.padEnd(13)} (${st.kind === 'human' ? '人間' : '自動'})${st.record ? ` ${st.record.at.slice(0, 16)} ${st.record.by}` : ''}${extra}`);
  }
  lines.push('', `次にやること: ${nextAction(s)}`);
  return lines;
}

