# AI-Develope

Human-on-the-Loop 型の AI駆動開発基盤です。AI チーム（PM と部下のサブエージェント）がウォーターフォール型のフェーズと品質ゲートを通りながら開発し、人間は要所で承認します。

- AI だけで勝手に作らない: ゲートは Claude Code の Hooks と GitHub Actions で**仕組みとして**強制します
- 人間の出番は 4 回（G0 計画・G1 要求・G2 設計・G3 最終）と、PR のマージだけです
- 要求からコード・レビュー・承認まで、ID で双方向に辿れます

設計の背景: [docs/memo/01_platform_design.md](docs/memo/01_platform_design.md)

## はじめに（1 回だけ）

```bash
npm run setup        # git フック（コミット規約）を有効化、環境チェック
gh auth login        # GitHub CLI のログイン（PR 作成に使う）
```

GitHub 側で main ブランチの保護（直接 push 禁止・PR 必須・quality-gate の成功を必須）を設定してください。

## 使い方

Claude Code で `/pm` と入力すると、PM が状態を確認して次の作業を進めます。人間の承認が必要なところで止まり、何を確認すればよいかを伝えます。

### 人間がやること

| タイミング | やること | コマンド |
|---|---|---|
| G0 計画承認 | docs/plan.md（手法・ロードマップ・バックログ）を確認 | `npm run approve -- G0` → plan PR をマージ |
| G1 要求承認 | 01_requirements.md と reviews/RV-01 を確認 | `npm run approve -- G1` |
| G2 設計承認 | 02_design.md と reviews/RV-02 を確認 | `npm run approve -- G2` |
| G3 最終承認 | PR の差分・CI・レビュー結果を確認し、動かしてみる | `npm run approve -- G3` → PR をマージ（マージコミット） |
| 差し戻し | 理由を付けて戻す | `npm run reject -- G2 "理由"` |
| テストの誤り | ロックを解除してテスト設計に戻す | `npm run reopen -- RED "理由"` |
| 基盤の変更 | 一時的に AI が基盤ファイルを変更できるようにする | `npm run maintenance -- on 2` / `off` |

承認・差し戻し・メンテナンスのコマンドは**対話端末でのみ**動きます（AI からは実行できません）。承認時には成果物のハッシュが記録され、承認後に成果物が変わると承認は自動で無効になります。

### フェーズの流れ

```
planning ─🔒G0─▶ requirements ─⚙REQ_REVIEW─🔒G1─▶ design ─⚙DESIGN_REVIEW─🔒G2─▶ test_design ─⚙RED─▶
implementation ─⚙GREEN─▶ ai_review ─⚙CODE_REVIEW─▶ final_review ─🔒G3─▶ done
```

| ゲート | 判定内容 |
|---|---|
| ⚙ REQ_REVIEW | 全 REQ に受入基準がある、要求レビューの Critical が解決済み |
| ⚙ DESIGN_REVIEW | 全 Must 要求に設計がある、WP 表がある、設計レビューの指摘が解決済み |
| ⚙ RED | 全受入基準にテストがある、テストが**失敗する**、テストレビュー済み → テストをロック |
| ⚙ GREEN | テスト・lint・型チェックが成功、トレーサビリティに欠落なし |
| ⚙ CODE_REVIEW | 観点別コードレビューの Critical 0・Major 解決済み |

## AI チーム

| 役割 | モデル | 担当 |
|---|---|---|
| PM（メインセッション） | セッションのモデル | 計画・手法選択・タスク分解・委任・進捗管理。コードは書かない |
| explorer | haiku | 調査（要約だけ返す） |
| requirements | opus | 要求定義 |
| architect | opus | 設計・作業パッケージ |
| test-designer | sonnet | テスト計画・失敗するテスト |
| implementer | sonnet | TDD 実装（WP 単位、並列時は worktree） |
| reviewer | opus | コールドレビュー（経緯を知らない第三者として、観点別に並列） |
| review-aggregator | sonnet | 指摘をレビュー記録にまとめる |

役割ごとに書き込める場所はフックで制限されています（例: reviewer は何も書けない、PM はコードを書けない）。

### 相互レビュー（コールドレビュー）

作った AI とは別の AI が、作業の経緯を知らない状態でレビューしたことを、ゲートが機械的に確認します。

1. **依頼の制限**: reviewer への指示は「レビュー番号・観点・対象・基準」の 4 行だけ。経緯や意見を書くとフックが止める
2. **実施記録**: reviewer の終了時に、観点・対象のハッシュ・実際に読んだファイル・モデル・生の指摘をフックが `.ai-dev/cycles/<サイクル>/reviews/` に記録
3. **照合**: ゲートは観点ごとに次をすべて満たす実施記録を求める
   - reviewer であり、対象ファイルを書いたエージェントとは別（書き込み記録の ID と照合）
   - 1 回の指示で起動した新しいエージェント（追加指示・使い回しは無効）
   - 対象ファイルを実際に読んでいる
   - 対象が最終版（レビュー後に変更されていない）で、必要なファイルをすべて含む

必須の観点は `.ai-dev/config.json` の `reviewPerspectives` で決まります。PR 本文には実施記録の一覧が載ります。

**基盤（このテンプレート自体）の変更も同じ**です。基盤ファイル（`.claude/`・`scripts/`・`.github/` など）を変える PR は、レビュー番号 `RV-PF`（観点: ガードの抜け穴 / ロジックの正しさ / ドキュメントとの整合 / 保守性）の相互レビューがそろわないと CI が通りません。RV-PF はメンテナンスモード中か `feature/*` ブランチで依頼でき、指摘表は `docs/memo/reviews/RV-PF_<ブランチ>.md` に残します。手元では `npm run gate -- PLATFORM_REVIEW` で確認できます。

## Hooks（ゲートの強制）

| フック | 役割 |
|---|---|
| guard-write（PreToolUse） | フェーズ・役割・WP 所有パス・テストロック・TDD・.skip 禁止・保護ファイルを判定 |
| guard-bash（PreToolUse） | 承認コマンド、保護パスへの書き込み、force push・main へのコミットなどを禁止 |
| guard-agent（PreToolUse） | reviewer への依頼を決められた 4 行に限定（経緯を渡せない）。レビュー済み reviewer の再利用を禁止 |
| session-context（SessionStart / UserPromptSubmit） | 現在の状態を数行だけ注入 |
| post-edit（PostToolUse） | Prettier / ESLint |
| stop-gate（Stop / SubagentStop） | 実装中はテスト等が通るまで終了させない。承認待ちを通知 |

判定ロジックは `scripts/lib/policy.mjs` に集約し、`npm run test:platform` でテストしています。

## ブランチと PR

ブランチ戦略はプロジェクト開始時（/plan）に PM が人間に聞いて提案し、`docs/plan.md` に書いて G0 で確定します。スクリプト（サイクルの分岐元・PR の宛先・保護ブランチ・並列実装の可否）はその内容に従います。

| 戦略 | 流れ | 向いている場面 |
|---|---|---|
| github-flow（既定） | `main ← cycle/* ← wp/*` | 1 チーム、サイクルごとにリリース |
| git-flow-lite | `main ← develop ← cycle/* ← wp/*` | 複数サイクルをまとめてリリース、ステージング環境がある |

- 以下は github-flow の例: `main`（保護）← `cycle/C-001-<名前>`（1 サイクル = 1 PR）← `wp/C-001/WP-01`（並列実装）
- コミット: `feat(C-001): 要約` + `Refs: REQ-001, TC-001`（commit-msg フックと CI で検証）
- AI は cycle/* ・ wp/* ・ plan/* にだけ push でき、PR のマージは人間だけが行います

## ディレクトリ

```
.ai-dev/            ゲートの状態・承認記録（スクリプトだけが更新）
.claude/            agents / skills / commands / hooks / settings.json
docs/cycles/C-xxx/  サイクルごとの成果物・レビュー記録・タスク票・トレーサビリティ
docs/templates/     成果物テンプレート
scripts/            ゲート判定・承認・トレーサビリティ・PR 作成
tests/hooks/        基盤自体のテスト
```

## 既知の限界

- Bash のコマンド判定はパターン照合のため、すべての抜け道は塞げません。最終的な検証は CI（成果物ハッシュと承認記録の再検証、テストの再実行）で行います
- `.claude/settings.json` の変更は Claude Code の再起動後に反映されます
