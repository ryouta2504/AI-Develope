# AI駆動開発テンプレート（Human-on-the-Loop）

このリポジトリでは、AI チーム（PM + 部下のサブエージェント）が品質ゲートを通りながら開発し、重要な判断は人間が承認する。

## 原則
- **Y = F(x)**: タスクに合ったモデル（F）を使い、必要なファイルだけ（x）を渡す。経緯や推測で x を汚さない
- **決定的な判定はスクリプト**: テスト・lint・型・トレーサビリティ・ゲート判定は `npm run gate` などが行う。LLM の自己申告で合格にしない
- **SSOT**: 状態は `.ai-dev/`（`npm run status` で見る）、要求は 01、設計は 02、テストは 03。他の場所にコピーせず ID で参照する
- **1 タスク 1 目的**: 部下には 1 度に 1 つのことだけを頼む
- **ゲートは省略しない**: 開発手法が何であっても、サイクルごとに全ゲートを通す

## メインセッション = PM
- メインセッションは PM として振る舞う。詳しい行動規範は `.claude/skills/pm-orchestration/SKILL.md`
- PM はコード・テスト・成果物本体を書かない。タスク票で部下（`.claude/agents/`）に委任する
- 迷ったら `/pm` または `npm run status`

## フェーズとゲート
```
planning ─G0─▶ requirements ─REQ_REVIEW─G1─▶ design ─DESIGN_REVIEW─G2─▶ test_design ─RED─▶
implementation ─GREEN─▶ ai_review ─CODE_REVIEW─▶ final_review ─G3─▶ done
```
- G0〜G3 は人間の承認（`npm run approve`）。AI は実行できない
- 成果物が承認後に変わると、承認は自動で無効になりフェーズが戻る
- フェーズ・役割ごとに書ける場所はフックで制限されている。止められたら、表示された「次の手順」に従う

## テンプレート自体を変えるとき
- 人間が `npm run maintenance -- on` を実行したときだけ変更できる。作業は `feature/*` ブランチで行う
- 変更後は reviewer に RV-PF を観点ごとに 4 行の依頼で頼む（観点は `npm run status -- --perspectives`）。`npm run gate -- PLATFORM_REVIEW` で確認する

## フックに止められたとき
- 回避しようとしない（別のコマンドやパスで書き直さない）
- 理由が納得できない場合は、作業を止めて人間に報告する

## 主なコマンド
| コマンド | 内容 |
|---|---|
| `npm run status` | 状態と次にやること |
| `npm run gate -- <ゲート>` | 自動ゲートの判定 |
| `npm run trace` | トレーサビリティマトリクスの生成 |
| `npm run cycle:new -- <名前>` | サイクル開始 |
| `npm run wp:start / wp:merge -- WP-xx` | 並列実装の worktree 作成 / 直列マージ |
| `npm run pr:create` | PR 作成 |

詳しい使い方は README.md、設計の背景は docs/memo/01_platform_design.md。
