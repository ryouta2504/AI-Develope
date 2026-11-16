---
description: architect エージェントに設計（作業パッケージ表を含む）を作成させる
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md`）。

1. `npm run status` で phase が design であることを確認する
2. タスク票を作る（担当: architect）
   - 目的: 承認済みの要求定義を満たす設計を書く
   - 読むもの: 01_requirements.md、現在の 02_design.md、（必要なら）explorer の調査要約
   - 書いてよい場所: 02_design.md
   - 完了条件: すべての Must 要求に DES があり、WP 表（所有パス・依存）がある
3. architect エージェントを起動する
4. 終わったら /review-design に進む

人間からの補足: $ARGUMENTS
