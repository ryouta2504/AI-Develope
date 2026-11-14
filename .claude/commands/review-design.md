---
description: 設計をコールドレビューし、DESIGN_REVIEW ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「コールドレビューの依頼方法」）。

1. `npm run status -- --perspectives` で RV-02 の観点を確認し、観点ごとに reviewer を 1 人ずつ、**1 つのメッセージで並列に**新しく起動する。指示文は 4 行だけ:
   ```
   レビュー番号: RV-02
   観点: <RV-02 の観点の 1 つ>
   対象: docs/cycles/<サイクル>/02_design.md
   基準: docs/cycles/<サイクル>/01_requirements.md
   ```
2. 返答を review-aggregator に渡し、`reviews/RV-02_design.md` に記録させる
3. Critical / Major があれば architect に修正タスク → 新しい reviewer で再レビュー → 状態更新
4. `npm run gate -- DESIGN_REVIEW` を実行する
5. 合格したら、人間に確認してほしい点（技術選定・WP の切り方など 5 行以内）をまとめ、`npm run approve -- G2` を依頼して止まる
