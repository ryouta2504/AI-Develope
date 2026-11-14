---
description: 実装を観点別に並列でコールドレビューし、CODE_REVIEW ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「コールドレビューの依頼方法」）。

1. `npm run status` で phase が ai_review であることを確認する
2. `npm run status -- --perspectives` で RV-05 の観点を確認し、観点ごとに reviewer を 1 人ずつ、**1 つのメッセージで並列に**新しく起動する。指示文は 4 行だけ:
   ```
   レビュー番号: RV-05
   観点: <RV-05 の観点の 1 つ>
   対象: src/, e2e/
   基準: docs/cycles/<サイクル>/01_requirements.md, docs/cycles/<サイクル>/02_design.md, docs/cycles/<サイクル>/03_test_plan.md
   ```
3. 返答を review-aggregator に渡し、`reviews/RV-05_code.md` に記録させる
4. Critical / Major は担当 WP の implementer に修正タスク（修正すると GREEN が無効になるので、修正後に `npm run gate -- GREEN` を再実行）
5. 修正すると src/ が変わり、全観点の実施記録が無効になる。修正がすべて終わってから、全観点を新しい reviewer で再レビュー → aggregator が状態を「対応済（コミット）」に更新
6. `npm run gate -- CODE_REVIEW` を実行する
7. 合格したら /pr に進む
