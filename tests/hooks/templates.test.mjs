// docs/templates の雛形のテスト: 注意書きの ID の例が、定義として拾われない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRequirements, extractDefinitions } from '../../scripts/lib/ids.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'docs', 'templates', f), 'utf8');

test('要求定義の雛形: 注意書きの REQ-004 などは定義にならない（見出しの REQ だけが定義）', () => {
  for (const f of ['01_requirements.md', '01_requirements_refactor.md']) {
    const { reqs } = parseRequirements(read(f));
    assert.ok(reqs.has('REQ-001'), f);
    for (const id of reqs.keys()) assert.ok(['REQ-001', 'REQ-002', 'NFR-001'].includes(id), `${f}: ${id} が定義として拾われています`);
  }
});

test('テスト計画の雛形: 注意書きは TC の定義にならない', () => {
  const defs = extractDefinitions(read('03_test_plan.md'), ['TC']);
  assert.deepEqual([...defs.keys()], ['TC-001']);
});

test('テスト計画の雛形の WP は、設計書の雛形が定義している WP と合っている', () => {
  const wp = read('03_test_plan.md').match(/\| TC-001 \|[^\n]*\| (WP-\d+) \|/)?.[1];
  assert.ok(wp, 'テスト計画の例に WP がありません');
  assert.ok(read('02_design.md').includes(`| ${wp} |`), `${wp} は設計書の雛形に定義がありません`);
});
