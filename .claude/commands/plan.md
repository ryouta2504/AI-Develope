---
description: 開発計画（手法・ロードマップ・バックログ）を作成し、人間の G0 承認に回す
---

PM として開発計画を作ります（`.claude/skills/pm-orchestration/SKILL.md` の「開発手法の選び方」に従う）。

1. `npm run status` で phase が planning か idle であることを確認する
2. main 上にいる場合は `git switch -c plan/<今日の日付>` で計画用ブランチを作る
3. 人間の要望（$ARGUMENTS と会話）を整理する。不明点があれば、推奨案を添えて質問する
4. 必要なら explorer を並列に起動して調査させる（要約だけ受け取る）
5. ブランチ戦略を人間に聞く。pm-orchestration スキルの「ブランチ戦略の提案」に従い、推奨案を先頭にして AskUserQuestion で 1 回にまとめて質問する（戦略・マージ方式・並列実装）
6. `docs/templates/plan.md` をもとに `docs/plan.md` を書く（PM が書いてよい唯一の成果物）。ブランチ戦略は表と `ai-dev:branching` ブロックの両方に書く
7. `docs(plan): 開発計画を作成` でコミットし、`git push -u origin <ブランチ>` する
8. `gh pr create --base <ai-dev:branching の統合ブランチ（github-flow なら main、git-flow-lite なら develop）>` で PR を作り、人間に次を依頼して止まる:
   - 計画の確認 → `npm run approve -- G0` → PR をマージ
