---
description: PR を作成し、人間の最終レビュー（G3）とマージに回す
---

1. `npm run status` で phase が final_review であることを確認する
2. `npm run pr:create` を実行する（トレーサビリティ再生成 → push → PR 作成。本文は自動生成）
3. 人間に次を依頼して止まる（5 行以内）:
   - PR の URL と、特に見てほしい点（保留した指摘、判断に迷った点）
   - 差分と CI（G3 以外が合格）を確認 → `npm run approve -- G3` → CI がすべて合格 → 計画で選んだ方式でマージ
4. G3 承認後・マージ前に /retro を実行するよう伝える（振り返りも同じ PR に含めるため）
