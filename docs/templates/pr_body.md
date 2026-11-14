## 概要
サイクル **{{CYCLE}}** の成果物です。人間による確認（G3）とマージをお願いします。

## 対象の要求
{{REQUIREMENTS}}

## 自動チェック（GREEN 判定時）
{{CHECKS}}

## レビュー結果
{{REVIEWS}}

## 承認記録
{{APPROVALS}}

## トレーサビリティ
<details><summary>マトリクスを開く</summary>

{{TRACE}}
</details>

## 人間に確認してほしいこと
- 保留・却下したレビュー指摘の理由が妥当か
- 要求（REQ）と受入基準（AC）が意図どおりに満たされているか（実際に動かして確認）

## マージ前の手順
ブランチ戦略: {{BRANCHING}}

1. 差分と CI の結果を確認する（この時点では G3 だけが不合格です）
2. `npm run approve -- G3` で最終承認する（承認記録がコミット・push され、CI が再実行されます）
3. CI がすべて合格したら、{{MERGE}}でマージする

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
