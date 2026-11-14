---
name: traceability
description: トレーサビリティの ID 体系（REQ / AC / NFR / DES / WP / TC / RV / G）と紐づけ方、自動生成マトリクス（npm run trace）の使い方。成果物を書くとき・トレース欠落でゲートに落ちたときに読む。
---

# トレーサビリティ

## ID の流れ
REQ（要求）→ AC（受入基準）→ DES（設計）→ WP（作業パッケージ）→ TC（テスト）→ コミット → RV（レビュー指摘）→ G（承認）

| ID | 定義する場所 | 書き方 |
|---|---|---|
| REQ-001 / NFR-001 | 01_requirements.md | 見出し `### REQ-001: ...` |
| AC-001-1 | 01_requirements.md | REQ の下の箇条書き |
| DES-001 | 02_design.md | 表の 1 列目。同じ行に REQ を書く |
| WP-01 | 02_design.md | WP 表の 1 列目。同じ行に DES を書く |
| TC-001 | 03_test_plan.md | 表の 1 列目。同じ行に AC を書く |
| TC-001（コード） | テストファイル | テスト名に `[TC-001][AC-001-1]` |
| コミット | git | `Refs: REQ-001, TC-001` |
| RV-05-001 | reviews/ | 指摘表の 1 列目。対象の ID を同じ行に |

**ルール: ID が行の先頭（見出し・表の 1 列目・箇条書きの先頭）にある行が定義、同じ行の他の ID が紐づけ先。**

## コマンド
- `npm run trace` … traceability.md を生成（手で編集しない）
- `npm run trace -- --check` … 現在のフェーズに応じて欠落をチェック

## よくある欠落と直し方
| メッセージ | 直し方 |
|---|---|
| REQ-xxx（Must）に対応する設計がありません | architect が DES を追加 |
| AC-xxx に対応するテストケースがありません | test-designer が TC を追加 |
| TC-xxx はテストコードにありません | テスト名に [TC-xxx] を入れる |
| 未定義の ID を参照しています | 誤記を直すか、定義を追加 |
