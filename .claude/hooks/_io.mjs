// フック共通: 標準入力の JSON を読む
export async function readInput() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

/** ブロック（exit 2 + stderr は Claude に伝わる） */
export function block(reason, hint) {
  process.stderr.write(`[GATE] ${reason}${hint ? `\n${hint}` : ''}\n`);
  process.exit(2);
}
