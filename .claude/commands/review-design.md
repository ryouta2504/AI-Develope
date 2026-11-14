---
description: 設計をコールドレビューし、DESIGN_REVIEW ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「コールドレビューの依頼方法」）。

1. reviewer を **3 つ並列に**、新しく起動する（基準はすべて 01_requirements.md）:
   - 観点「要求との整合」 / 観点「テストしやすさ（test-designer の視点）」 / 観点「保守性」
   - 対象: 02_design.md。経緯・あなたの意見は渡さない
2. 返答を review-aggregator に渡し、`reviews/RV-02_design.md` に記録させる
3. Critical / Major があれば architect に修正タスク → 新しい reviewer で再レビュー → 状態更新
4. `npm run gate -- DESIGN_REVIEW` を実行する
5. 合格したら、人間に確認してほしい点（技術選定・WP の切り方など 5 行以内）をまとめ、`npm run approve -- G2` を依頼して止まる
