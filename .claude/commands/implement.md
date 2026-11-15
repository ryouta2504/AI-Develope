---
description: implementer に WP 単位で TDD 実装させ（並列は worktree）、直列にマージして GREEN ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「並列と直列」）。

1. `npm run status` で phase が implementation であることを確認する
2. 02_design.md の WP 表から実装順を決める（WP-00 と依存のある WP は先に、直列で）
3. **WP が 1〜2 個のとき**: サイクルブランチで、WP ごとに implementer を 1 人ずつ起動する
4. **並列にするとき**: 依存のない WP ごとに
   - `npm run wp:start -- WP-xx` で worktree を作る（表示された絶対パスを控える）
   - タスク票（担当: implementer）に worktree の絶対パス、所有パス、担当 TC を書く
   - 完了条件: worktree 内で `npm run gate -- wp WP-xx` が合格し、コミット済み
   - implementer を 1 つのメッセージで並列に起動する
5. 完了した WP から **1 つずつ** `npm run wp:merge -- WP-xx` でマージする（競合したら担当 implementer に解消タスク）
6. 全 WP のマージ後、`npm run gate -- GREEN`（README の GREEN の項目（テスト・lint・型・ビルド・E2E・トレーサビリティ））
7. 失敗したら、原因の WP の implementer に修正タスクを出す。3 回失敗したら人間に相談する
8. 合格したら /review-code に進む
