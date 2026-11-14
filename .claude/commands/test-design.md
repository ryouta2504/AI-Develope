---
description: test-designer にテスト計画と失敗するテスト（RED）を作らせ、テストレビューと RED ゲートを判定する
---

PM として進めます（`.claude/skills/pm-orchestration/SKILL.md`）。

1. `npm run status` で phase が test_design であることを確認する
2. テスト環境がまだなければ、最初に test-designer へ「テスト環境の準備」だけのタスク票を出す（react-testing スキルの初期セットアップ）
3. 02_design.md の WP 表を見て、WP ごとにタスク票を作る（担当: test-designer）
   - 目的: WP-xx の受入基準に対するテストケースとテストコードを書く
   - 読むもの: 01_requirements.md、02_design.md（WP-xx の部分）
   - 書いてよい場所: WP-xx の所有パス内のテストファイル、03_test_plan.md の WP-xx の行
   - 所有パスが重ならない WP は、1 つのメッセージで並列に起動する。03_test_plan.md は 1 人ずつ追記させる
4. reviewer を 2 つ並列に新しく起動する。指示文は 4 行だけ:
   ```
   レビュー番号: RV-03
   観点: 受入基準の網羅      ← もう 1 つは「テストの甘さ」
   対象: docs/cycles/<サイクル>/03_test_plan.md, src/, e2e/
   基準: docs/cycles/<サイクル>/01_requirements.md, docs/cycles/<サイクル>/02_design.md
   ```
   → aggregator が `reviews/RV-03_tests.md` に記録 → 指摘対応（修正後は新しい reviewer で再レビュー）
5. `npm run gate -- RED` を実行する（テストが失敗すること、全 AC に TC があることを確認し、テストをロック）
6. 合格したら /implement に進む
