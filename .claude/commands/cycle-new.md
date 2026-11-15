---
description: 新しい開発サイクル（スプリント）を開始する
---

1. `npm run status` で phase が idle か done であることを確認する
2. docs/plan.md のロードマップから、次のサイクルで扱うバックログ項目を確認する
3. 統合ブランチ（docs/plan.md の ai-dev:branching で決まる。main または develop）を最新にする。`cycle:new` が分岐元を自動で取得するので、手動の切り替えは不要
4. `npm run cycle:new -- <短い英語名>` を実行する（名前: $ARGUMENTS。なければロードマップから決める）
5. 作成されたブランチと成果物フォルダを報告し、/req に進む
