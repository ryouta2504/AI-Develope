# テスト計画: {{CYCLE}}

> 担当: test-designer エージェント / 方針: .claude/skills/tdd-cycle と react-testing
> テストコードのテスト名に [TC-xxx][AC-xxx-n] を必ず入れること。

## 1. 方針
- 単体・結合: Vitest + React Testing Library
- E2E: Playwright（主要な利用シナリオのみ）

## 2. テストケース
> TC の ID もサイクルをまたいで一意にする（2 サイクル目以降は前のサイクルの続き番号から。重なると RED で不合格）。下の TC-001 は書き方の例。WP も設計書の WP 表にあるものを書く
| TC | 対応 | 種別 | WP | 内容（前提 / 操作 / 期待結果） | ファイル |
|---|---|---|---|---|---|
| TC-001 | AC-001-1 | 結合 | WP-00 | | src/features/xxx/Xxx.test.tsx |

## 3. テストしないこと（理由）
