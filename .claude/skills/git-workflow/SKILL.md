---
name: git-workflow
description: ブランチ・コミット・PR のルール。cycle / wp / plan ブランチの使い方、コミットメッセージ規約（Conventional Commits + Refs）、PR の作成とマージの流れ。コミット・push・PR 作成の前に読む。
---

# Git ワークフロー

## ブランチ戦略
`docs/plan.md` の `ai-dev:branching` ブロック（G0 で承認済み）が唯一の情報源。github-flow なら統合ブランチは main、git-flow-lite なら develop。以下の「main」は統合ブランチと読み替える。保護ブランチ（main・develop）へは AI は直接コミット・マージできない。

## ブランチ
| ブランチ | 用途 | 作り方 |
|---|---|---|
| main | 保護。PR 経由で人間がマージしたときだけ更新 | - |
| plan/<日付> | 開発計画（G0）の作成。PR の宛先は統合ブランチ | `git switch -c plan/2026-11-14` |
| cycle/C-001-<名前> | 1 サイクル分の全成果物 | `npm run cycle:new -- <名前>` |
| wp/C-001/WP-01 | 並列実装（worktree） | `npm run wp:start -- WP-01` |
| feature/<名前> | テンプレート自体の変更（人間がメンテナンスモードを有効にしたときだけ） | 人間と相談して作る |

- 1 サイクル = 1 ブランチ = 1 PR
- AI が push できるのは cycle/* ・ wp/* ・ plan/*（メンテナンス中は feature/* も）だけ。保護ブランチへの統合は必ず PR

## コミットメッセージ
```
<type>(C-001): <要約>

Refs: REQ-001, AC-001-1, TC-003
```
| type | 場面 | Refs |
|---|---|---|
| docs | 要求・設計・テスト計画・レビュー記録 | 任意 |
| test | テストの追加（RED） | 必須 |
| feat / fix | 実装 | 必須 |
| refactor | リファクタリング | 任意 |
| chore | 状態・設定（スクリプトが自動で作る） | 不要 |

- git の commit-msg フックと CI で検証される
- 禁止（フックで止められる）: --no-verify、--amend、--force、rebase、reset --hard、main へのコミット

## PR
1. CODE_REVIEW 通過後、`npm run pr:create`（本文は自動生成）。この時点の CI は G3 だけが不合格になる
2. 人間が差分と CI（G3 以外がすべて合格）を確認し、`npm run approve -- G3`（承認記録が push され、CI が再実行される）
3. CI がすべて合格したら、人間が計画で選んだマージ方式でマージする（既定はマージコミット。ID 付きのコミットを残すため）
