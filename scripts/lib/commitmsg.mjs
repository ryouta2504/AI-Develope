// コミットメッセージ規約の検証（.githooks/commit-msg と CI で共用）
// 形式: <type>(<scope>): <要約>
//       サイクルのコミット（scope が C-xxx）で feat / fix / test のときは「Refs: <ID>」が必須
const TYPES = ['feat', 'fix', 'test', 'docs', 'refactor', 'chore', 'ci', 'build', 'perf', 'style'];

export function checkCommitMessage(msg) {
  const lines = msg.replace(/\r/g, '').split('\n').filter((l) => !l.startsWith('#'));
  const subject = (lines[0] || '').trim();
  if (/^Merge (branch|pull request|remote-tracking)/.test(subject)) return [];
  // GitHub Actions が PR の検証用に作る一時的なマージコミット
  if (/^Merge [0-9a-f]{7,40} into [0-9a-f]{7,40}$/.test(subject)) return [];
  if (/^Revert "/.test(subject)) return [];
  const m = subject.match(/^(\w+)(\(([^)]+)\))?!?: .+/);
  if (!m) return [`1 行目は「<type>(<scope>): <要約>」の形式にしてください（type: ${TYPES.join(' / ')}）`];
  const problems = [];
  if (!TYPES.includes(m[1])) problems.push(`type「${m[1]}」は使えません（${TYPES.join(' / ')}）`);
  const scope = m[3] || '';
  if (/^C-\d+/.test(scope) && ['feat', 'fix', 'test'].includes(m[1])) {
    const refs = lines.find((l) => /^Refs:\s*\S/.test(l));
    if (!refs || !/(REQ|NFR|AC|DES|WP|TC|RV)-(\d|PF-\d)/.test(refs)) problems.push('feat / fix / test のコミットには「Refs: REQ-001, TC-003」のように ID を書いてください');
  }
  return problems;
}
