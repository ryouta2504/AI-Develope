---
description: 実装を観点別に並列でコールドレビューし、CODE_REVIEW ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md` の「コールドレビューの依頼方法」）。

1. `npm run status` で phase が ai_review であることを確認する
2. reviewer を **4 つ並列に**、新しく起動する（経緯・あなたの意見は渡さない）:
   - 観点「要求適合」（基準: 01, 02, 03）/「セキュリティ」/「アクセシビリティ・UX」/「保守性」（基準: 02）
   - 対象: `git diff main...HEAD --stat` で変わった src/ と e2e/ のファイル
3. 返答を review-aggregator に渡し、`reviews/RV-05_code.md` に記録させる
4. Critical / Major は担当 WP の implementer に修正タスク（修正すると GREEN が無効になるので、修正後に `npm run gate -- GREEN` を再実行）
5. 修正後、該当観点で新しい reviewer に再レビュー → aggregator が状態を「対応済（コミット）」に更新
6. `npm run gate -- CODE_REVIEW` を実行する
7. 合格したら /pr に進む
