---
description: 要求定義をコールドレビューし、REQ_REVIEW ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「コールドレビューの依頼方法」）。

1. reviewer を **2 つ並列に**、新しく起動する。指示文は 4 行だけ（それ以外はフックで止められる）:
   ```
   レビュー番号: RV-01
   観点: 曖昧さ・テスト可能性      ← もう 1 つは「実現可能性」
   対象: docs/cycles/<サイクル>/01_requirements.md
   基準: docs/plan.md
   ```
2. 両方の返答を review-aggregator に渡し、`reviews/RV-01_requirements.md` に記録させる
3. Critical / Major があれば requirements エージェントに修正タスクを出す → 修正後、該当観点で新しい reviewer に再レビュー → aggregator が状態を更新
4. `npm run gate -- REQ_REVIEW` を実行する
5. 合格したら、人間に確認してほしい点（5 行以内）をまとめ、`npm run approve -- G1` を依頼して止まる
