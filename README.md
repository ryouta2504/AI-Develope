# AI-Develope

Human-on-the-Loop 型の AI駆動開発テンプレートです。AI チーム（PM と部下のサブエージェント）がフェーズと品質ゲートを通りながら開発し、人間は要所で承認します。

- AI だけで勝手に作らない: ゲートは Claude Code の Hooks と GitHub Actions で**仕組みとして**強制します
- 人間の出番は 4 回の承認（G0 計画・G1 要求・G2 設計・G3 最終）と、PR のマージです
- 要求からコード・レビュー・承認まで、ID で双方向に辿れます

**はじめて使う人は [導入ガイド（docs/GETTING_STARTED.md）](docs/GETTING_STARTED.md) から読んでください。** プロジェクトの作り方・置き場所・初期設定・最初のサイクルの回し方・困ったときの対処をまとめています。

設計の背景: [docs/memo/01_platform_design.md](docs/memo/01_platform_design.md) / データフロー図: [docs/memo/ai-team-dataflow.html](docs/memo/ai-team-dataflow.html)

## はじめに（1 回だけ）

プロジェクトは `C:\Users\<名前>\dev\` のような普通のフォルダに置いてください（`~/.claude` の中は不可）。

```bash
npm run setup        # git フック（コミット規約）を有効化
gh auth login        # GitHub CLI のログイン（PR 作成に使う）
npm run doctor       # 環境チェック（置き場所・ログイン・CODEOWNERS の担当者などを確認）
```

テンプレートから作ったプロジェクトでは、`.github/CODEOWNERS` の担当者を自分たちのアカウントに書き換えてください。

GitHub 側で次を設定してください（リポジトリ管理者の操作）。

- 統合ブランチ（main、git-flow-lite なら develop も）の保護: 直接 push 禁止、PR 必須、`gate`（ワークフロー quality-gate のジョブ名）の成功を必須
- **Require review from Code Owners**: `.github/CODEOWNERS` に列挙したファイルを変える PR に、コードオーナーのレビューを必須にする。列挙には、テンプレートのファイルのほか、**`/.ai-dev/`（承認・ゲートの記録）と `/package.json`** も含まれる。サイクルや計画の PR は必ず `.ai-dev` の記録を含むので、**ほぼすべての PR がコードオーナーのレビューの対象**になる（RV-PF が要求される範囲は、これより狭く、テンプレートのファイル `isPlatformFile` と `package.json` の scripts の変更だけ）

> 1 人で運用している場合、GitHub では PR の作成者が自分の PR を承認できません。コードオーナーのレビューを必須にすると、管理者の「バイパス」でしかマージできなくなります。その場合は「差分（特に `.ai-dev` の承認記録とテンプレートの変更）を自分で確認したうえで、毎回バイパスする」運用にしてください。

## 使い方

Claude Code で `/pm` と入力すると、PM が状態を確認して次の作業を進めます。人間の承認が必要なところで止まり、何を確認すればよいかを伝えます。

### 人間がやること

| タイミング | やること | コマンド |
|---|---|---|
| G0 計画承認 | docs/plan.md（手法・ロードマップ・バックログ・ブランチ戦略）を確認 | `npm run approve -- G0` → plan PR をマージ |
| G1 要求承認 | 01_requirements.md と reviews/RV-01 を確認 | `npm run approve -- G1` |
| G2 設計承認 | 02_design.md と reviews/RV-02 を確認 | `npm run approve -- G2` |
| G3 最終承認 | PR の差分と CI（G3 以外がすべて合格）を確認し、実際に動かしてみる | `npm run approve -- G3` → CI 再実行・合格 → PR をマージ |
| 差し戻し | 理由を付けて戻す（直前の自動ゲートと、差し戻したゲートより後のステップがすべて無効になり、作業できるフェーズへ戻る） | `npm run reject -- G2 "理由"` |
| テストの誤り | ロックを解除してテスト設計に戻す | `npm run reopen -- RED "理由"` |
| テンプレートの変更 | 一時的に AI がテンプレートのファイルを変更できるようにする | `npm run maintenance -- on 2` / `off` |

承認・差し戻し・メンテナンスのコマンドは**対話端末でのみ**動きます（AI からは実行できません）。承認時には成果物のハッシュが記録され、承認後に成果物が変わると承認は自動で無効になります。コマンドはこのフォルダ（`package.json` のある場所）で実行してください。

### フェーズの流れ

```
planning ─🔒G0─▶ requirements ─⚙REQ_REVIEW─🔒G1─▶ design ─⚙DESIGN_REVIEW─🔒G2─▶ test_design ─⚙RED─▶
implementation ─⚙GREEN─▶ ai_review ─⚙CODE_REVIEW─▶ final_review ─🔒G3─▶ done
```

| ゲート | 判定内容 |
|---|---|
| ⚙ REQ_REVIEW | 全 REQ に受入基準がある、要求レビューの指摘が解決済み、相互レビューの実施記録がそろっている |
| ⚙ DESIGN_REVIEW | 全 Must 要求に設計がある、WP 表がある、設計レビューの指摘が解決済み、実施記録がそろっている |
| ⚙ RED | 全受入基準にテストがある、テストが**失敗する**、テストレビュー済み → テストと設定をロック |
| ⚙ GREEN | テスト・lint・型チェック・ビルド・E2E が成功、テスト計画の全 TC に「成功」の実行結果がある |
| ⚙ CODE_REVIEW | 観点別コードレビューの指摘が解決済み（Critical は対応済か理由付き却下、Major は対応済か理由付きの保留・却下）、実施記録がそろっている |

## AI チーム

| 役割 | モデル | 担当 | 書ける場所 |
|---|---|---|---|
| PM（メインセッション） | セッションのモデル | 計画・手法選択・タスク分解・委任・進捗管理 | 計画・改善候補・負債台帳・タスク票・振り返り・メモ。コードは書けない（それ以外の未分類のファイルも書けない） |
| explorer | haiku | 調査（要約だけ返す） | なし |
| requirements | opus | 要求定義 | 01_requirements.md |
| architect | opus | 設計・作業パッケージ | 02_design.md |
| test-designer | sonnet | テスト計画・失敗するテスト・テスト環境 | 03・テスト・設定・雛形 |
| implementer | sonnet | TDD 実装（WP 単位、並列時は worktree） | 製品コード・雛形・新しいテスト |
| reviewer | opus | コールドレビュー（観点別に並列） | なし |
| review-aggregator | sonnet | 指摘をレビュー記録にまとめる | reviews/ |

役割の定義されていないエージェント（general-purpose など）は、何も書けません。

### 相互レビュー（コールドレビュー）

作った AI とは別の AI が、作業の経緯を知らない状態でレビューしたことを、ゲートと CI が機械的に確認します。

1. **依頼の制限**: reviewer への指示は「レビュー番号・観点・対象・基準」の 4 行だけ。経緯や意見を書くとフックが止める。タスク票・過去のレビュー・`.ai-dev` は対象・基準に指定できない
2. **実施記録**: reviewer の終了時に、観点・対象のハッシュ・実際に Read したファイル・モデル・生の指摘をフックが `.ai-dev/` に記録
3. **照合**: 観点ごとに次をすべて満たす実施記録を求める
   - reviewer であり、対象ファイルを書いたエージェントとは別（書き込み記録の ID と照合）
   - 1 回の指示で起動した新しいエージェント（追加指示・使い回しは無効）
   - 対象ファイルを実際に Read している
   - 対象が最終版（レビュー後に変更されていない）で、必要なファイルをすべて含む

レビュー番号と必須の観点は `npm run status -- --perspectives` で確認できます（設定は `scripts/lib/config.mjs` の既定値を `.ai-dev/config.json` で上書き）。PR 本文には実施記録の一覧が載ります。

**テンプレート自体の変更も同じ**です。テンプレートのファイル（`.claude/`・`scripts/`・`.github/`・README など）を変える PR は、レビュー番号 `RV-PF` の相互レビューがそろわないと CI が通りません。RV-PF はメンテナンスモード中か `feature/*` ブランチで依頼でき、指摘表は `docs/memo/reviews/RV-PF_<ブランチ>.md` に残します。手元では `npm run gate -- PLATFORM_REVIEW` で確認できます。

## Hooks（ゲートの強制）

| フック | 役割 |
|---|---|
| guard-write（PreToolUse） | フェーズ・役割・WP 所有パス・テストロック・TDD・テストの中身・保護ファイル・プロジェクト外を判定。パスはジャンクションや Windows の表記揺れを解決してから判定 |
| guard-bash（PreToolUse） | 承認コマンド、保護パスへの書き込み（入れ子のシェル・cd を含む）、リンクの作成、force push・保護ブランチへのコミット、GitHub API でのマージ・承認などを禁止 |
| guard-agent（PreToolUse） | reviewer への依頼を 4 行に限定。レビュー済み reviewer の再利用を禁止 |
| guard-mcp（PreToolUse） | 書き込み系の MCP ツールを禁止（`mcpAllow` に登録したものだけ許可） |
| tripwire（PreToolUse / PostToolUse、全ツール） | 手段を問わず、メンテナンスモードでないのにテンプレートのファイルや承認記録（G0〜G3）が変わっていたら、基準（直前に確認した状態。基準がなければ git の HEAD）へ元に戻す。人間が手で直した分も、メンテナンスモード外なら、次のツール実行のときに戻される（`npm run maintenance -- off` の直後は、メンテナンスの記録を復元せず、そのまま解除される）。ゲートの記録（gates/・runs）はスクリプトが正当に書くため対象外 |
| session-context（SessionStart / UserPromptSubmit） | 現在の状態を数行だけ注入 |
| post-edit（PostToolUse） | 書き込んだエージェントの記録、Prettier / ESLint |
| stop-gate（Stop / SubagentStop） | implementer はチェックが通るまで終了させない。reviewer の実施記録を残す。PM は止めずに承認待ちを通知 |

判定ロジックは `scripts/lib/policy.mjs` に集約し、`npm run test:platform` でテストしています。保護の中心はフックです（`settings.json` の permissions の deny は `.ai-dev` と一部のコマンドの補助的な防御だけ）。

## ブランチと PR

ブランチ戦略はプロジェクト開始時（/plan）に PM が人間に聞いて提案し、`docs/plan.md` に書いて G0 で確定します。スクリプト（サイクルの分岐元・PR の宛先・保護ブランチ・並列実装の可否）はその内容に従います。

| 戦略 | 流れ | 向いている場面 |
|---|---|---|
| github-flow（既定） | `main ← cycle/* ← wp/*` | 1 チーム、サイクルごとにリリース |
| git-flow-lite | `main ← develop ← cycle/* ← wp/*` | 複数サイクルをまとめてリリース、ステージング環境がある |

- 1 サイクル = 1 ブランチ = 1 PR
- コミット: `feat(C-001): 要約` + `Refs: REQ-001, TC-001`（commit-msg フックと CI で検証）
- AI が push できるのは `cycle/*` ・ `wp/*` ・ `plan/*`（メンテナンス中は `feature/*` も）だけ。保護ブランチへの統合は PR 経由で、マージは人間だけ
- マージ方式は計画で選んだもの（既定はマージコミット。要求 ID 付きのコミットを残すため）

## ディレクトリ

```
.ai-dev/            ゲートの状態・承認記録・相互レビューの実施記録（スクリプトとフックだけが更新）
.claude/            agents / skills / commands / hooks / settings.json
docs/plan.md        開発計画（G0 で承認。バックログとブランチ戦略を含む）
docs/improvements.md 振り返りなどから出た改善候補（未承認）
docs/debt.md        技術的負債の台帳（`npm run debt`。解消は `/refactor` のリファクタリングサイクルで行う）
docs/cycles/C-xxx/  サイクルごとの成果物・レビュー記録・タスク票・トレーサビリティ
docs/templates/     成果物テンプレート
scripts/            ゲート判定・承認・トレーサビリティ・PR 作成
tests/hooks/        テンプレート自体のテスト
```

## 既知の限界

- **承認記録の真正性**: 承認記録には署名がありません。`.ai-dev` への書き込みはフックで止めていますが、AI がプログラムを実行できる以上、承認記録を偽造する経路を完全には塞げません。現在は「人間が PR の差分（`.ai-dev/**/approvals/` の変更）を確認する」ことで担保しています。実運用で導入する際は、承認コミットに人間の署名（SSH 署名など）を必須にし、CI で `git verify-commit` により検証する方式を推奨します
- **任意コードの実行**: `npm test` などで製品コードが動く以上、実行されたプログラムによる書き込みまでは止められません。最終的な防衛線は CI（ハッシュ・承認・テスト・相互レビューの再検証）と人間の PR レビューです
- **CI 自体の書き換え**: CI のスクリプトも PR の中身で動きます。`.github/CODEOWNERS` とブランチ保護で、テンプレートのファイルを変える PR に人間のレビューを必須にしています
- **シェルコマンドの判定**: パターン照合（禁止する書き方の列挙）のため、すべての書き方は網羅できません。`&`・`$(…)`・`if / then` の後ろ・`npm run` の別の書き方などは判定しますが、引用符の連結・変数による保護パスの隠蔽・`xargs` / `find -delete`・文字列の連結による回避（例: `pty` の語を分割して書く）は止められません。これらを使うと、tripwire が監視しない場所（`.ai-dev/cycles/*/gates/`・`reviews/runs.jsonl`・製品コード・ロック済みテストなど）に書けます。止めるのは、tripwire（テンプレートと承認記録）・CI の再検証（ゲート記録・実施記録とハッシュの照合）・コードオーナーのレビュー・人間の PR 確認です。「列挙の網羅」を目標にせず、結果で検出する層を重ねる設計です
- **tripwire の基準**: 基準は `.ai-dev/.cache/tripwire/` にあります。ファイルの欠落・ハッシュの不一致は検出して git の HEAD から作り直しますが、基準とインデックスを矛盾なく書き換えられる（列挙外の手段で）場合は検出できません。ツールの中でテンプレートを書き換えて commit した変更は、PR の差分と CI の RV-PF 照合・コードオーナーのレビューで止めます。ツールの実行中に `npm run maintenance -- on` を実行すると、tripwire に消されるので、AI が作業していないときに実行してください
- `.claude/settings.json` の変更は Claude Code の再起動後に反映されます
