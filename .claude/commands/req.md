---
description: requirements エージェントに要求定義を作成させる
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md`）。

1. `npm run status` で phase が requirements であることを確認する
2. タスク票を作る（担当: requirements）
   - 目的: このサイクルのバックログ項目（docs/plan.md の該当行）について要求定義を書く
   - 読むもの: docs/plan.md、現在のサイクルの 01_requirements.md、（あれば）explorer の調査要約
   - 書いてよい場所: 01_requirements.md
   - 完了条件: すべての REQ に AC があり、未決事項が明記されている
3. requirements エージェントを起動する
4. 完了報告の「未決事項」があれば、人間に質問してから再度タスク票を出す
5. 終わったら /review-req に進む

人間からの補足: $ARGUMENTS
