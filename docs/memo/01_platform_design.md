# 全体設計案: Human-on-the-Loop 型 AI駆動開発基盤

- 作成日: 2026-11-14
- 版: v4（v3 からの追加: 役割ごとの書き込み権限、コールドレビュー・相互レビュー、SSOT、1 タスク 1 目的）
- v3: AI チーム体制（PM によるオーケストレーション）、開発手法の選択、G0 計画承認
- v2: 並列/直列の方針、トレーサビリティ、レビュー記録、ブランチ・PR ルール、GitHub リポジトリ
- ステータス: **承認待ち**（承認後に実装を開始する）
- 元の依頼: [00_setup_prompt.md](00_setup_prompt.md)
- リポジトリ: https://github.com/ryouta2504/AI-Develope （main ブランチ）

---

## 0. 基本方針

| 原則 | 内容 |
|---|---|
| Y = F(x) | タスクに合ったモデル（F）を選び、必要なコンテキスト（x）だけを渡す |
| 決定的な処理は LLM に任せない | テスト・lint・型チェック・ゲート判定・トレーサビリティ検証・マージ可否はスクリプトで判定する。LLM は「考える・書く」部分だけを担う |
| 判断は直列、作業は並列 | フェーズ遷移・ゲート・承認・マージは直列。フェーズ内の独立した作業はサブエージェントで並列化する |
| すべてを記録する | 成果物・レビュー・承認・ゲート結果は ID 付きで git に残し、要求からコードまで双方向に辿れるようにする |
| ゲートは仕組みで強制する | Hooks（ローカル）と GitHub Actions（サーバー側）の二重で強制する |
| 手法は自由、ゲートは不変 | PM（AI リーダー）はスクラム・MVP・ウォーターフォールなど手法を選べる。ただし品質ゲートはどの手法でも省略できない |

## 0.5 AI チーム体制

### 0.5.1 構成

```
                 👤 人間（プロダクトオーナー / 承認者）
                   │  G0 計画承認・G1 要求承認・G2 設計承認・G3 最終承認・PR マージ
                   ▼
        🧭 PM（AI リーダー）= メインセッション
           計画・手法選択・タスク分解・割り当て・進捗管理・エスカレーション
           ※ 自分ではコードを書かない。部下の報告（要約）だけを見る
                   │ 指示（タスク票）          ▲ 報告（完了報告票）
     ┌──────────┬──────┴────┬──────────┬──────────┐
     ▼            ▼              ▼            ▼            ▼
 explorer   requirements   architect   test-designer  implementer   reviewer ×観点  review-aggregator
 (調査)      (要求)         (設計)       (テスト)        (実装)          (レビュー)      (指摘の集約)
```

- **PM はメインセッション**: Claude Code のサブエージェントは別のサブエージェントを起動できないため、指示を出すリーダーはメインセッションが担う。`/pm` コマンドで PM として起動し、CLAUDE.md に PM の行動規範を書く
- **部下はサブエージェント**: PM から「タスク票」を受け取ると、担当範囲の中で自律的に作業する（例: implementer はテストが通るまで Red → Green → Refactor を自分で回す）。終わったら「完了報告票」で要約を返す
- **PM の情報源は報告とゲート結果だけ**: PM がコードやログを直接読むとコンテキストが汚れるため、部下の要約とスクリプトの判定結果で判断する（Y = F(x) の x の衛生管理）

### 0.5.2 PM の責務と権限

| 責務 | 内容 |
|---|---|
| 計画 | 人間の要望から、開発手法・ロードマップ・バックログを作成し、G0 で人間の承認を得る |
| 分解・割り当て | バックログ項目をサイクルに割り当て、フェーズ内の作業をタスク票にして部下に渡す |
| 並列/直列の判断 | WP 表の所有パスと依存関係を見て、並列に動かせる部下を判断する |
| 進捗管理 | `.ai-dev/` の状態とゲート結果を見て、次の作業を決める。差し戻されたら原因を特定して再割り当てする |
| エスカレーション | 次の場合は作業を止めて人間に相談する: 要求が曖昧、同じゲートで 3 回失敗、部下の報告が矛盾する、スコープ変更が必要 |

| PM にできないこと（フックで制限） |
|---|
| src/、e2e/ のコードを直接編集すること（部下に任せる） |
| 承認・差し戻し、PR のマージ（人間だけ） |
| ゲートの判定結果を上書きすること |

### 0.5.3 タスク票と完了報告票

PM と部下のやり取りは決まった形式で行い、受け渡す情報を最小限にする。

```markdown
## タスク票 T-C001-012
- 担当: implementer
- サイクル / WP: C-001 / WP-02-filter
- 目的: フィルタ機能を実装し、TC-010〜TC-015 を通す
- 読むもの: 02_design.md の DES-004、src/features/filter/ 配下のテスト
- 書いてよい場所: src/features/filter/**
- 完了条件: 担当テストがすべて成功、lint・型チェック成功
- 禁止事項: テストの変更、担当外ファイルの編集
```

```markdown
## 完了報告票 T-C001-012
- 結果: 完了 / 一部完了 / 失敗
- 成果: 実装したファイルの一覧、成功したテスト ID
- コミット: b7c8d9e（Refs: DES-004, TC-010..015）
- 懸念・判断した点: （PM と人間に伝えたいことを 3 行以内）
```

- タスク票と完了報告票は `docs/cycles/<サイクル>/tasks/` に残す（誰が何をしたかのトレーサビリティ）

### 0.5.4 開発手法の選択

PM は案件に合わせて手法を選び、G0 で人間の承認を得る。どの手法でも「サイクル」がフェーズを 1 周する単位になり、品質ゲートは同じように適用される。

| 手法 | 向いている場面 | サイクルの対応 | 人間ゲートの意味 |
|---|---|---|---|
| ウォーターフォール | 要求が固まっている、小〜中規模 | 全体を 1 サイクル | G1 要求承認 → G2 設計承認 → G3 受入 |
| MVP | 仮説検証したい、まず動くものが欲しい | C-001 = MVP（Must だけ）、以降は改善サイクル | 各サイクルで G1〜G3。MVP 後に人間が次の方向を判断 |
| スクラム | 要求が変わりやすい、継続的に機能を足す | 1 スプリント = 1 サイクル | G1 = スプリント計画の承認、G3 = スプリントレビュー |

- **G0 計画承認（追加）**: 手法・ロードマップ・プロダクトバックログ（`docs/backlog.md`）を PM が作り、人間が承認する。G0 がないと最初のサイクルを開始できない
- バックログの優先順位を変える、手法を変える場合も G0 の再承認が必要
- スプリントごとの振り返り（何がうまくいったか、ゲートで何回止まったか）を PM が `docs/cycles/<サイクル>/retro.md` に残し、次のサイクルの計画に反映する

### 0.5.5 部下の自律性の範囲

| 部下が自分で判断してよいこと | PM に戻すこと |
|---|---|
| 担当範囲内の実装方法、テストの書き方、リファクタリング | 担当外のファイルを変更したくなった |
| ゲート失敗時の修正（最大 3 回まで自分で再試行） | 3 回失敗した、設計の誤りや矛盾に気づいた |
| 自分の担当範囲のコミット | 要求や設計を変える必要がある |

### 0.5.6 役割ごとの書き込み権限（フックで強制）

検証結果（2026-11-14）: サブエージェント内で発火したフックの入力には `agent_type`（エージェント名）と `agent_id` が含まれ、メインセッションでは含まれない。これを使い、**誰が**書こうとしているかでも判定する。

| 役割（agent_type） | 書き込める場所（フェーズ条件に加えて） |
|---|---|
| メイン（PM） | docs/plan.md、docs/improvements.md、docs/debt.md、tasks/、retro.md、docs/memo/（テンプレートのレビュー記録を含む）のみ。未分類のファイルは書けない。コード・テスト・成果物本体は書けない |
| requirements | 01_requirements.md |
| architect | 02_design.md |
| test-designer | 03_test_plan.md、テストファイル、テスト・ビルド設定 |
| implementer | src/ のテスト以外（新規テストの追加は可） |
| reviewer | なし（読み取りのみ） |
| review-aggregator | reviews/ のみ |
| explorer | なし |
| 上記以外（general-purpose など） | なし（役割の決まっていない汎用エージェントには書かせない） |

## 0.6 相互レビュー（コールドレビュー）と SSOT

### 0.6.1 コールドレビュー: 何も知らない状態でレビューする
作った本人の思い込みを持ち込まないため、レビューは**作業の経緯を知らない**レビュアーが行う。

- reviewer は毎回新しいサブエージェントとして起動する（サブエージェントは親の会話履歴を引き継がない）
- PM が reviewer に渡すのは「レビュー対象のファイルパス」「観点」「基準となる上流成果物のパス」だけ。PM の意見・作業の経緯・作成者の説明は渡さない（タスク票のテンプレートで項目を固定する）
- reviewer は成果物そのものだけを読み、「初めてこの文書・コードを見た人」として、曖昧な点・矛盾・抜けを指摘する
- **作成者とレビュアーを必ず分ける**（相互レビュー）

| 成果物 | 作成 | レビュー |
|---|---|---|
| 要求定義 | requirements | reviewer（要求の曖昧さ・テスト可能性）+ architect の視点（実現可能性） |
| 設計 | architect | reviewer（要求との整合）+ test-designer の視点（テストしやすさ） |
| テスト | test-designer | reviewer（受入基準を網羅しているか、テストが甘くないか） |
| 実装 | implementer | reviewer ×観点（要求適合・セキュリティ・a11y/UX・保守性） |

- 「〜の視点」は、その役割の立場でレビューする reviewer を新規に起動する（作成した本人のセッションは使わない）
- レビュー記録には、レビュアーに渡した入力（読んだファイルとハッシュ）も残し、同じ条件で再現できるようにする

### 0.6.2 SSOT（信頼できる唯一の情報源）
同じ情報を複数の場所に書かない。食い違いが起きると、LLM はどちらを信じるべきかわからなくなり、出力の精度が落ちる。

| 情報 | 唯一の置き場所 | 他の場所での扱い |
|---|---|---|
| 要求・受入基準 | 01_requirements.md | ID で参照する。本文をコピーしない |
| 設計・作業パッケージ | 02_design.md | ID で参照する |
| テストケース | 03_test_plan.md とテストコード（テスト名の ID で対応） | ID で参照する |
| フェーズ・承認・ゲート結果 | .ai-dev/（スクリプトが状態を算出） | 文書に「承認済み」などと書かない。`npm run status` で見る |
| プロセスのルール | Skills と CLAUDE.md | エージェント定義には「どの skill を読むか」だけを書く |
| トレーサビリティ | 各成果物の ID から自動生成 | traceability.md は生成物。手で編集しない |
| 進捗・タスク | tasks/ のタスク票・完了報告票 | — |

### 0.6.3 部下には 1 度に 1 つのことだけをさせる
- タスク票 1 枚 = 目的 1 つ、完了条件 1 つ、成果物 1 種類
  - 良い例: 「WP-02 のフィルタ機能を実装し、TC-010〜015 を通す」
  - 悪い例: 「フィルタ機能を実装して、ついでに設計書も直して、テストも追加して」
- 書いてよい場所はタスク票で限定し、役割ごとの書き込み権限（0.5.6）とあわせてフックで強制する
- 部下が別の作業の必要に気づいたら、自分でやらずに完了報告票の「懸念」に書いて PM に返す。PM が新しいタスク票を作る
- 1 つのタスクが大きくなりすぎる場合（目安: 変更ファイル 10 個超、または完了条件のテストが 10 件超）、PM はタスクを分割する

## 1. ディレクトリ構成

```
AI-Develope/
├─ CLAUDE.md                     # プロセス要約・原則・ゲートのルール（短く）
├─ README.md                     # 人間向けの使い方
├─ package.json                  # npm scripts
├─ .ai-dev/                      # ★ゲートの状態（AIは書き込み禁止・git管理）
│  ├─ current.json               #   現在アクティブなサイクル ID
│  └─ cycles/C-001/
│      ├─ state.json             #   フェーズ・自動ゲート結果・履歴
│      ├─ approvals/G1.json      #   人間の承認記録（承認者・日時・成果物ハッシュ・コメント）
│      └─ locks/test-lock.json   #   RED 確定時のテストファイルのハッシュ
├─ .claude/
│  ├─ settings.json              # ★Hooks と permissions
│  ├─ hooks/                     # ★フック本体（Node.js .mjs）
│  ├─ agents/                    # サブエージェント定義
│  ├─ skills/                    # 再利用手順
│  └─ commands/                  # スラッシュコマンド
├─ .githooks/                    # ★git フック（commit-msg でコミット規約を検証）
├─ .github/
│  ├─ workflows/quality-gate.yml # ★PR 時のサーバー側ゲート
│  └─ pull_request_template.md
├─ scripts/                      # ★ゲート判定・承認・トレーサビリティ・ブランチ操作
├─ docs/
│  ├─ memo/                      # 基盤自体のメモ
│  ├─ templates/                 # 成果物テンプレート
│  └─ cycles/C-001-todo-basic/   # ← 開発サイクルごとに成果物をまとめる（上書きせず履歴として残す）
│      ├─ 01_requirements.md
│      ├─ 02_design.md
│      ├─ 03_test_plan.md
│      ├─ reviews/               #   レビュー記録（AI・人間とも）
│      │   ├─ RV-01_requirements.md
│      │   ├─ RV-02_design.md
│      │   └─ RV-05_code.md
│      └─ traceability.md        #   自動生成のトレーサビリティマトリクス
├─ src/                          # 製品コード（React）。単体テストは隣に *.test.tsx
├─ e2e/                          # Playwright の E2E テスト
└─ tests/hooks/                  # フック・ゲートのテスト（node:test）
```

★ = ゲートの仕組みそのもの。permissions の deny とフックの二重で、AI からの書き換えを禁止する。

**サイクル**: 1 つの機能追加・改修のまとまりを「サイクル」（ID: `C-001`、`C-002` …）と呼び、サイクルごとにフェーズを 1 周する。成果物はサイクル単位のフォルダに残るので、過去の要求・設計・レビューも後から追える。

## 2. 開発プロセスと状態遷移

```
 【プロジェクト単位】 planning（PM が手法・ロードマップ・バックログを作成）─🔒G0─▶ サイクル開始可能

 【サイクル単位】
 requirements ─⚙REQ_REVIEW─🔒G1─▶ design ─⚙DESIGN_REVIEW─🔒G2─▶ test_design ─⚙RED─▶ implementation
                                                                                         │
             done ◀─🔒G3+PRマージ─ final_review ◀─⚙CODE_REVIEW─ ai_review ◀─⚙GREEN+TRACE──┘

 差し戻し: npm run reject -- <G1|G2|G3> "理由"
   → 該当フェーズへ戻り、それ以降の承認・自動ゲート結果・テストロックを無効化（差し戻し記録は残す）
```

v1 からの変更点: **人間ゲート（G1 / G2）の前に AI レビューを入れる**。人間は AI が指摘・修正した後の成果物とレビュー記録を見て判断できるため、確認の負担が減る。

| フェーズ | 書き込み可能 | 次へ進む条件 |
|---|---|---|
| requirements | 01_requirements.md | ⚙ REQ_REVIEW: AI レビューの指摘が解決済み（Critical は対応済か理由付き却下）→ 🔒 G1 |
| design | 02_design.md | ⚙ DESIGN_REVIEW: AI レビューの指摘が解決済み、全 Must 要求に設計 ID が紐づく → 🔒 G2 |
| test_design | 03_test_plan.md、`src/**/*.test.ts(x)`、`e2e/**` | ⚙ RED: テストが失敗する、全受入基準にテスト ID が紐づく → テストをロック |
| implementation | `src/**`（ロック済みテストは除く） | ⚙ GREEN: test / lint / typecheck 成功 + ⚙ TRACE: マトリクスに欠落なし |
| ai_review | reviews/RV-05_code.md | ⚙ CODE_REVIEW: 指摘が解決済み（Critical は対応済か理由付き却下、Major は対応済か理由付きの保留・却下） |
| final_review | なし（AI は書き込み不可） | PR 作成 → 🔒 G3（人間）→ 人間が PR をマージ |

## 3. 並列と直列の方針

### 3.1 直列で行うもの（決定的・順序が意味を持つもの）
- フェーズ遷移、ゲート判定、人間の承認・差し戻し
- 要求定義 → 設計（設計は確定した要求に依存するため）
- RED の確定とテストのロック
- 作業パッケージのブランチをサイクルブランチへマージする操作（1 つずつマージし、毎回 GREEN を確認する）
- 統合後のテスト実行、PR 作成

### 3.2 並列で行うもの（独立していて、結果を後で統合できるもの）
| フェーズ | 並列化する作業 | 統合方法 |
|---|---|---|
| requirements | explorer（haiku）×N で既存コード・類似事例を調査 | 要約だけを requirements エージェントに渡す |
| 各 AI レビュー | 観点別の reviewer を並列実行（例: 要求適合 / セキュリティ / アクセシビリティ・UX / 保守性） | 指摘を 1 つのレビュー記録に集約し、重複を除く |
| test_design | 作業パッケージごとに test-designer を並列実行 | 03_test_plan.md に統合、テスト ID を採番し直さないよう WP ごとに番号帯を割り当てる |
| implementation | 作業パッケージごとに implementer を並列実行（**git worktree で隔離**） | WP ブランチを 1 つずつサイクルブランチにマージ |

### 3.3 並列実装の前提条件（衝突を防ぐ）
- 設計書に **作業パッケージ（WP）表** を必ず書く。WP ごとに「担当ファイル（所有パス）」「依存する WP」を明記する
- 所有パスが重ならない WP だけを並列に動かす。依存関係がある WP は依存先のマージ後に開始する
- フックは、WP ブランチ上では自分の所有パス以外への書き込みをブロックする（WP 表から判定）
- 共有ファイル（型定義、ルーティングなど）は「共通基盤 WP（WP-00）」として最初に直列で実装する

## 4. トレーサビリティ

### 4.1 ID 体系
| 種別 | ID 形式 | 定義する場所 | 紐づけ先 |
|---|---|---|---|
| 要求 | `REQ-001`（優先度 Must / Should / Could） | 01_requirements.md | — |
| 受入基準 | `AC-001-1` | 01_requirements.md（要求の下） | REQ |
| 非機能要求 | `NFR-001` | 01_requirements.md | — |
| 設計要素 | `DES-001` | 02_design.md | REQ / NFR |
| 作業パッケージ | `WP-01` | 02_design.md | DES |
| テストケース | `TC-001` | 03_test_plan.md、テストコード | AC / NFR |
| レビュー指摘 | `RV-05-003`（レビュー番号 + 連番） | reviews/*.md | 対象 ID / ファイル |
| 承認 | `G1` / `G2` / `G3` | .ai-dev/cycles/*/approvals/ | 成果物ハッシュ |

### 4.2 紐づけ方
- 設計書・テスト計画書の表に「対応 ID」列を設ける（例: `DES-003 | 対応: REQ-001, REQ-004`）
- テストコードはテスト名に ID を入れる: `it('[TC-007][AC-002-1] 期限切れのタスクは赤で表示される', ...)`
- コミットメッセージに ID を入れる（6章のコミット規約）
- 製品コード内には ID を書かない（コードを汚さず、テストとコミットから辿る）

### 4.3 自動生成と検証（`npm run trace`）
スクリプトが成果物・テストコード・テスト結果・git 履歴を読み、traceability.md を生成する。

```
| REQ     | 優先 | AC       | DES     | WP    | TC     | 結果 | コミット | レビュー指摘 |
|---------|------|----------|---------|-------|--------|------|----------|--------------|
| REQ-001 | Must | AC-001-1 | DES-001 | WP-01 | TC-001 | ✅   | a1b2c3d  | RV-05-002(済)|
```

ゲートで検証すること:
- DESIGN_REVIEW: すべての Must 要求に DES が 1 つ以上ある
- RED: すべての受入基準（AC）に TC が 1 つ以上ある
- TRACE: すべての TC が成功している、定義されていない ID への参照がない、どの要求にも紐づかない孤立 ID がない

## 5. レビュー記録

AI のレビューも人間のレビューも、同じ形式で reviews/ に残す。

```markdown
# RV-05 コードレビュー
- 対象: C-001 / commit a1b2c3d / src/**
- レビュアー: reviewer(opus) ×4 観点（要求適合・セキュリティ・a11y/UX・保守性）
- 日時: 2026-11-20 10:00

| 指摘 ID | 重大度 | 観点 | 対象 | 内容 | 状態 | 対応 |
|---|---|---|---|---|---|---|
| RV-05-001 | Major | a11y | src/TodoItem.tsx | チェックボックスにラベルがない | 対応済 | commit d4e5f6a |
| RV-05-002 | Minor | 保守性 | src/useTodos.ts | … | 保留 | 理由: C-002 で対応（REQ-010 として起票） |
```

- 重大度の基準（Critical / Major / Minor）は review-checklist スキルで定義する
- 状態は `未対応` → `対応済`（修正コミットを記録）/ `保留`（理由必須）/ `却下`（理由必須）
- ゲートは「Critical は対応済か理由付き却下」「Major はすべて解決（対応済、または理由付きの保留・却下）」で判定する（ids.mjs の reviewProblems）
- 人間の承認・差し戻しコメントも approvals/ と reviews/ に残る。PR 上の人間のコメントは PR のリンクを G3 承認記録に残す

## 6. ブランチ・コミット・PR のルール

### 6.1 ブランチ
```
main ─────────────────────────────────────────●───── (保護。PR経由でのみ更新)
   └─ cycle/C-001-todo-basic ──●──●──●──●──●──┘   サイクル単位。全フェーズの成果物をここにコミット
          ├─ wp/C-001/WP-01-list ──●──●─┘          作業パッケージ単位（並列実装時のみ）
          └─ wp/C-001/WP-02-filter ──●──●─┘
```

| ブランチ | 命名 | 作成元 | マージ先 | 作成・マージする人 |
|---|---|---|---|---|
| main | — | — | — | 人間が PR をマージしたときだけ更新 |
| サイクル | `cycle/C-001-<短い名前>` | main | main（PR） | 作成: `npm run cycle:new`（スクリプト）、マージ: 人間 |
| 作業パッケージ | `wp/C-001/WP-01-<短い名前>` | サイクルブランチ | サイクルブランチ | 作成・マージ: `npm run wp:start` / `npm run wp:merge`（スクリプトが GREEN を確認してから 1 つずつマージ） |
| 緊急修正 | `cycle/C-00x-hotfix-<名前>` | main | main（PR） | 通常のサイクルと同じ（フェーズは短く書いてよいが、ゲートは省略しない） |

- 1 サイクル = 1 サイクルブランチ = 1 PR
- フックで禁止する操作: main へのコミット・プッシュ、`--force` プッシュ、`--no-verify`、`git reset --hard`、`git rebase`（main / サイクルブランチ上）、ブランチの削除
- AI のプッシュは `cycle/*` と `wp/*` ブランチだけ許可する

### 6.2 コミット
Conventional Commits 形式 + ID。`.githooks/commit-msg` で検証する。

```
<type>(C-001): <要約>

<本文（任意）>

Refs: REQ-001, AC-001-1, TC-003
```

| type | 使う場面 |
|---|---|
| docs | 要求・設計・テスト計画・レビュー記録 |
| test | テストの追加（RED） |
| feat / fix | 実装（GREEN） |
| refactor | リファクタリング（テストは変えない） |
| chore | 状態ファイル・設定（スクリプトが自動で作る） |

- `feat` / `fix` / `test` のコミットは `Refs:` が必須
- ゲート通過・承認・差し戻しのたびに、スクリプトが `chore(C-001): gate RED passed` のようなコミットを自動で作る（履歴だけでプロセスが追える）

### 6.3 プルリクエスト
- **作成タイミング**: CODE_REVIEW 通過後（final_review フェーズに入ったとき）
- **作成方法**: `npm run pr:create` が PR 本文を自動生成して作成する
- **PR 本文**（テンプレートから自動生成）
  - サイクルの概要と対象の要求一覧
  - トレーサビリティマトリクス（traceability.md の要約）
  - テスト結果（件数・カバレッジ）、lint・型チェック結果
  - AI レビューの要約（指摘件数、保留中の指摘と理由）
  - G1 / G2 の承認記録（承認者・日時）
  - 人間が確認すべきポイント（AI が判断に迷った点、保留した指摘）
- **マージ方式**: マージコミット（squash しない）。ID 付きのコミットを main に残すため
- **マージする人**: 人間だけ。G3 承認後にマージする

### 6.4 GitHub Actions（サーバー側のゲート）
PR が作られたら次を実行する。ローカルのフックを迂回されても、ここで止める。
- test / lint / typecheck / build
- `npm run trace -- --check`（トレーサビリティの欠落検出）
- 承認記録の検証（G1 / G2 が存在し、成果物ハッシュが一致するか）
- コミットメッセージ規約の検証

GitHub 側の推奨設定（リポジトリ管理者が設定）:
- main のブランチ保護: 直接プッシュ禁止、PR 必須、上記 Actions の成功を必須、force push 禁止

## 7. Hooks の判定ロジック

判定ロジックは `scripts/lib/policy.mjs` に集約し、フックは「入力を読んで policy を呼び、結果を返す」だけにする。policy は単体テストで全ルールを検証する。

### 7.1 guard-write.mjs（PreToolUse: Write / Edit / MultiEdit / NotebookEdit）
上から順に判定し、最初に当たったルールで決定する。
1. ★保護パス → ブロック
2. 現在のフェーズで書き込みが許可されていないパス → ブロック
3. 承認済み（凍結）の成果物 → ブロック
4. WP ブランチ上で、その WP の所有パス以外 → ブロック
5. implementation で、ロック済みテストファイルを編集 → ブロック
6. implementation で `src/X.tsx` を作成・編集するとき、`src/X.test.tsx` がない → ブロック（TDD の強制）
7. テストに `.skip(` / `.only(` / `xit(` を追加 → ブロック
8. それ以外 → 許可

ブロック時のメッセージ例（短く、次の手順を示す）:
```
[GATE] src/ は現在のフェーズ(design)では編集できません。
次の手順: docs/cycles/C-001-todo-basic/02_design.md を仕上げ、/review-design を実行してください。
```

### 7.2 guard-bash.mjs（PreToolUse: Bash / PowerShell）
- 承認・差し戻しスクリプトの実行 → ブロック
- ★保護パス・フェーズで禁止されたパスへの書き込み（`>`、`tee`、`cp`、`mv`、`rm`、`sed -i`、`Set-Content`、`node -e` での fs 書き込みなど）→ ブロック
- 6.1 で禁止した git 操作 → ブロック
- パターン照合なので完全ではない。承認記録は 7.6 の方法でも守り、最終的には GitHub Actions で検証する

### 7.3 session-context.mjs（SessionStart / UserPromptSubmit）
次の数行だけを注入する（コンテキストを汚さない）。
```
[AI-DEV] C-001 phase=design branch=cycle/C-001-todo-basic | G1=承認済 G2=未
許可: docs/cycles/C-001-todo-basic/02_design.md | 次: /design → /review-design → 人間の G2 承認
```

### 7.4 post-edit.mjs（PostToolUse: Write / Edit / MultiEdit）
編集したファイル（src/、e2e/）に Prettier と ESLint をかけ、エラーがあれば先頭の数件だけを返す。

### 7.5 stop-gate.mjs（Stop / SubagentStop）
- implementation で、前回 GREEN 後に src/ が変わっていれば test / lint / typecheck を実行し、失敗なら終了をブロックして要約を返す
- `stop_hook_active` が true なら再ブロックしない（無限ループ防止。連続ブロックは最大 3 回）
- 人間ゲートの手前なら「人間の承認待ち: npm run approve -- G2」と表示して停止を許可する

### 7.6 人間の承認（scripts/approve.mjs）
- 対話端末（TTY）でのみ動作し、`APPROVE G2` の手入力とコメント入力を求める。AI の Bash は TTY を持たないため実行できない
- 承認記録: 承認者（git config user.name）、日時、対象成果物の SHA-256、レビュー記録の参照、コメント
- ハッシュが変わると承認は自動で無効になる
- 承認記録は自動でコミットされる

## 8. サブエージェントとモデルの割り当て

| エージェント | model | tools | 入力 | 出力 | 並列 |
|---|---|---|---|---|---|
| explorer | haiku | Read, Glob, Grep | 調査依頼 | 要約のみ | ○ |
| requirements | opus | Read, Write, Edit, Glob, Grep | 要望、explorer の要約 | 01_requirements.md | — |
| architect | opus | Read, Write, Edit, Glob, Grep | 01 | 02_design.md（WP 表を含む） | — |
| test-designer | sonnet | Read, Write, Edit, Glob, Grep, Bash | 01, 02（担当 WP 分） | テスト計画（担当分）、テストコード | ○（WP 単位） |
| implementer | sonnet | Read, Write, Edit, Glob, Grep, Bash | 02（担当 WP 分）、担当テスト | src/（所有パスのみ） | ○（WP 単位・worktree） |
| reviewer | opus | Read, Glob, Grep | 対象成果物、観点 | 指摘一覧（返答のみ） | ○（観点単位） |
| review-aggregator | sonnet | Read, Write, Edit | 各 reviewer の指摘 | reviews/RV-xx.md | — |

- reviewer はファイルを書かない。指摘の集約と記録は review-aggregator が行う（書き込み権限を分ける）
- 各エージェントの指示には「読むファイルを限定する」「返答は要約だけ」を入れる

## 9. Skills

| skill | 内容 |
|---|---|
| requirements-writing | 要求・受入基準・非機能要求の書き方、ID の振り方 |
| design-doc | 設計書の構成、WP 表の書き方（所有パス・依存関係） |
| tdd-cycle | Red → Green → Refactor の手順と禁止事項 |
| react-testing | Vitest + RTL + Playwright の方針、テスト名への ID の入れ方 |
| review-checklist | 観点別チェックリスト、重大度の基準 |
| traceability | ID 体系、紐づけ方、コミット規約 |
| git-workflow | ブランチ・コミット・PR のルール |

## 10. スラッシュコマンド

| コマンド | 内容 |
|---|---|
| /pm | PM（AI リーダー）として起動し、状態を読んで次の作業を部下に割り当てる |
| /plan | 手法・ロードマップ・バックログを作成 → 人間の G0 承認へ |
| /status | 現在のサイクル・フェーズ・承認状態・次にやること |
| /cycle-new | 新しいサイクルを開始（ID 採番、ブランチ作成） |
| /req → /review-req | 要求定義 → AI レビュー（観点別に並列） |
| /design → /review-design | 設計 → AI レビュー |
| /test-design | テスト設計（WP 単位で並列）→ RED 判定 |
| /implement | 実装（WP 単位で並列・worktree）→ 直列マージ → GREEN + TRACE 判定 |
| /review-code | コードレビュー（観点別に並列）→ CODE_REVIEW 判定 |
| /pr | PR 本文を生成して作成 |
| /retro | サイクルの振り返りを作成し、次の計画に反映 |

承認・差し戻しはスラッシュコマンドにしない。人間がターミナルで `npm run approve` / `npm run reject` を実行する。

## 11. 実装の順序

1. **ゲートの中核**: scripts/lib（state, policy, hash, ids）、gate / approve / reject / status / cycle
2. **フック**: 5 本のフック、settings.json（hooks + permissions）、.githooks/commit-msg
3. **テスト**: tests/hooks/ で全ルールのブロック・許可を検証 ← 通るまで次へ進まない
4. トレーサビリティ（`npm run trace`）とレビュー記録の検証
5. エージェント、Skills、コマンド、テンプレート
6. ブランチ・PR スクリプト、GitHub Actions、PR テンプレート
7. CLAUDE.md、README.md
8. サンプル（React ToDo アプリ）で 1 サイクル回す手順書

基盤自体の構築は `feature/platform-setup` ブランチで行い、PR で main にマージする。

## 12. 決定事項・確認事項

| 項目 | 決定 |
|---|---|
| GitHub CLI | 導入済み（v2.104.0）。`gh auth login` は人間が実行する |
| AI のプッシュ | `cycle/*` と `wp/*` へのプッシュを許可。main への反映は必ず PR 経由 |
| PR | AI が `npm run pr:create` で作成し、人間がレビュー・G3 承認・マージする |
| AI チーム | PM（メインセッション）+ 部下（サブエージェント）。手法は PM が選び G0 で承認 |
| React の雛形 | サンプルの G2 承認後に作る |

未確認:
- **main のブランチ保護**: GitHub のリポジトリ設定で有効にできるか（リポジトリ管理者の操作が必要）

## 13. 実装後の追記（2026-11-14）

### 13.1 相互レビューの強制（0.6.1 の実装）
検証結果: SubagentStop フックの入力には `agent_id`・`agent_type`・`agent_transcript_path`（サブエージェントの全履歴）が含まれる。履歴の 1 行目が受け取った指示文で、Read などのツール呼び出しと使用モデルも記録されている。

| 仕組み | 実装 |
|---|---|
| 依頼の制限 | `guard-agent.mjs`（PreToolUse: Agent/Task）。reviewer への指示は 4 行（レビュー番号・観点・対象・基準）だけ |
| 再利用の禁止 | `guard-agent.mjs`（PreToolUse: SendMessage）。実施済み reviewer への追加指示をブロック |
| 作成者の記録 | `post-edit.mjs`。書き込みごとに agent_id を `activity.jsonl` へ |
| 実施記録 | `stop-gate.mjs`（SubagentStop: reviewer）。`reviews/runs.jsonl` と `reviews/raw/<agent_id>.md` |
| 照合 | `scripts/lib/review-evidence.mjs`。REQ_REVIEW / DESIGN_REVIEW / RED / CODE_REVIEW と CI で実行 |

### 13.2 フック設定の書き方
Windows では Git Bash が見つからない環境があり、`"command": "node \"$CLAUDE_PROJECT_DIR/...\""` 形式では変数が展開されなかった。`"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/..."]` 形式（シェルを使わない）にし、ガード系には `"onFailure": "block"` を付けた。

### 13.3 雛形ファイル
React の雛形（main.tsx・index.html・CSS・型定義）は「scaffold」として分類し、test_design フェーズから test-designer が置けるようにした（TDD のテスト必須チェックの対象外）。

### 13.4 テンプレートの相互レビュー（RV-PF 1 回目）を受けた変更
RV-PF 1 回目（reviewer 4 観点、Critical 6・Major 約 30・Minor 21）の指摘により、本文の次の記述は現在の実装に置き換わっている。

| 本文の記述 | 現在 |
|---|---|
| ★のパスは permissions の deny とフックの二重で守る（1 章） | 保護の中心はフック。deny は `.ai-dev` と一部コマンドの補助的な防御だけ（メンテナンスモードと両立させるため） |
| バックログは `docs/backlog.md`（0.5.4・0.5.6） | 承認済みのバックログは `docs/plan.md`（G0 の対象）だけ。振り返りなどの改善候補は `docs/improvements.md`（未承認） |
| マージ方式はマージコミット（6.3） | 計画で選ぶ（既定はマージコミット。squash も選べる） |
| AI の push は cycle/* と wp/*（6.1） | cycle/* ・ wp/* ・ plan/*。メンテナンス中は feature/* も |
| フェーズごとの書き込み可能な場所（2 章の表） | `scripts/lib/policy.mjs` の `PHASE_WRITABLE` と `ROLE_WRITABLE` が SSOT。雛形（scaffold）・ビルド成果物の種別を追加 |
| G3 承認 → CI（6.3） | PR 作成 → CI（G3 だけ不合格）→ 人間が確認して G3 承認 → CI 再実行・合格 → マージ |
| 差し戻しは該当フェーズに戻る（2 章） | 差し戻したゲートの直前の自動ゲートも無効にする（G3 の差し戻しで implementation に戻り、コードを直せる） |

#### RV-PF 2 回目（Critical 6・Major 25・Minor 27）を受けた変更

| 本文の記述 | 現在 |
|---|---|
| ステータス「承認待ち」 | 実装済みで、テンプレート自体を RV-PF で相互レビュー中 |
| `state.json` と `locks/test-lock.json`（4・7 章） | 状態は保存せず、`.ai-dev/approvals/`・`gates/` の記録と成果物ハッシュから毎回算出する。テストのロックは RED の記録 |
| ディレクトリ構成に `RV-03_tests.md` と `docs/memo/reviews/` がない | どちらも存在する（テストレビュー記録・テンプレートのレビュー記録） |
| stop-gate は implementer と PM を止める（7.5） | PM は止めない。implementer の終了時だけ GREEN を確認し、連続ブロックは合格までの回数で数える（最大 3 回） |
| review-aggregator の tools は Read・Write・Edit | Glob・Grep も持つ |
| CI は cycle/* と plan/* を検査する（6.3） | cycle/*・plan/*・feature/*・リリース PR だけ許可し、それ以外は不合格（fail-closed）。plan/* は計画と G0 の記録以外の変更を不合格にする。PR の head をチェックアウトして照合する |
| 書き込み手段の列挙で保護する（1 章） | 列挙に加え、`.claude/hooks/tripwire.mjs` が、ツール実行の前後でテンプレートと承認記録の差分を見て元に戻す（手段を問わず結果で止める最後の砦） |
| 差し戻しは直前の自動ゲートだけ無効にする | 差し戻したゲートより後の全ステップを無効にする |
| PM の書ける場所は plan・tasks・retro・memo | plan・improvements・debt・tasks・retro・memo。未分類のファイルは書けない。done フェーズでも plan は直せる |
| ゲート条件は「Critical 0 件」 | Critical は対応済か理由付き却下、Major は対応済か理由付きの保留・却下 |
| （なし） | 技術的負債の台帳（`docs/debt.md`、`npm run debt`）とリファクタリング専用サイクル（`cycle:new -- --refactor --debt DEBT-xxx`）を追加 |

方針の判断（人間）:
- 承認記録の HMAC 検証（RV-PF-002 の一部）: 導入しない。人間と AI が同じユーザー・同じマシンで動くため、AI から隔離できる秘密を持てず、形だけの対策になる。代わりにガードの強化・tripwire・CI の再検証・人間の PR レビュー（CODEOWNERS）で守る
- 承認記録の真正性（Critical 2）: 署名は導入せず、既知の限界として README に明記。実運用で導入する際は、承認コミットへの人間の署名と CI での検証を推奨
- CI 自体の書き換え（Critical 3）: `.github/CODEOWNERS` とブランチ保護で、テンプレートのファイルを変える PR にコードオーナーのレビューを必須にする

#### RV-PF 3 回目（Critical 7）を受けた変更

| 本文の記述 | 現在 |
|---|---|
| tripwire は PreToolUse でスナップショットを取り、PostToolUse で比べて戻す（上の 2 回目の表） | ツールごとのスナップショットをやめ、恒久的な基準（`.ai-dev/.cache/tripwire/base`）と比べる。メンテナンス中は基準を更新し、そうでなければ Pre・Post のたびに差分を戻す（Post が発火しなかった変更・Post の後の変更も次の Pre で戻る）。基準がなければ git の HEAD を基準にする。HEAD が動いたときは、HEAD と一致する変更だけ受け入れる（ブランチ切り替え・マージ）。Post では、実行中に作られた maintenance.json は信用しない。並列のツール呼び出しでも壊れない |
| tripwire の監視範囲は PLATFORM と同じ | PLATFORM に加え、サイクルごとの承認記録（`.ai-dev/cycles/*/approvals`、G1〜G3）と、全階層の `CLAUDE.md` / `CLAUDE.local.md`。ゲートの記録（`gates/`・`runs.jsonl`・`activity.jsonl`）は、スクリプトとフックが AI のツール実行の中で正当に書くため監視しない（偽造はハッシュの照合・CI の再検証・人間の PR レビューで止める） |
| git の操作は書き込み先の列挙で検査（7.2） | `git revert` と `git pull` を禁止。`git merge` と `git switch` / `checkout <ref>` は、今のサイクルの承認・ゲート記録と G0・メンテナンス・設定を変えてしまうとき禁止（差し戻しの取り消し防止）。同じコマンドの中の `git switch main && …` に追従して保護ブランチを判定する。`GIT_CONFIG_*` などの `GIT_*` 環境変数は禁止 |
| 人間専用スクリプトは `scripts/` を含む引数で検出（7.2） | `node approve.mjs` のように `scripts/` を含まない呼び出しも、スクリプト名で検出する。`env -u`・`sudo -u`・`timeout`・`nohup` などのラッパーのオプションを飛ばして本体のコマンドを判定する。`script`・`expect`・`winpty`・`Start-Process` などの疑似端末・別コンソールの起動を禁止。`requireHuman` は `CLAUDECODE` の値ではなく変数の有無で判定する。同じ PC で人間と AI が動く以上、完全には防げない（既知の限界。承認コミットへの署名と CI での検証は将来の課題） |
| `gh api` は変更系のメソッド・パスを禁止 | 読み取り（GET）だけ許可する（`-f`・`-F`・`--input`・graphql・`-X` が GET 以外は禁止）。パスの `merges` も禁止 |
| `>` のリダイレクトで書き込み先を検査 | 上書きリダイレクト `>\|` も検査する |
| ID は「サイクル内で連番」（4.1・4.3） | REQ・TC の ID は**サイクルをまたいで一意**にする（2 サイクル目は続き番号）。他のサイクルが定義した TC・AC は今のサイクルの判定から除外し、ID が前のサイクルと重なったら不合格にする |
| reviewer の原文は `last_assistant_message` を保存 | 空のときは transcript の hand-back（`SubagentHandback` / `SendMessage` のツール呼び出し）または最後のテキストを保存する（原文が空になるのを防ぐ。hand-back のツール名は未確認で、`handback` / `sendmessage` を含む名前を対象にしている） |
