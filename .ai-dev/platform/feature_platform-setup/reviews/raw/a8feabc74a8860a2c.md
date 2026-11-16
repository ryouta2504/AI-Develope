# RV-PF / 保守性 / a8feabc74a8860a2c

## 指示

レビュー番号: RV-PF
観点: 保守性
対象: .claude, scripts, .githooks, .github, tests/hooks, docs/templates, docs/GETTING_STARTED.md, docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md, CLAUDE.md, README.md, .gitattributes, .gitignore, package.json, .ai-dev/config.json
基準: docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md

## 指摘（原文）

| 重大度 | 観点 | 対象（ファイル:行 または ID） | 内容 | 根拠 | 提案 |
|---|---|---|---|---|---|
| Major | 保守性 | .github/CODEOWNERS:4-16 / scripts/lib/config.mjs:69-93 | テンプレートのファイル一覧が、`PLATFORM`（と `isPlatformFile`）と CODEOWNERS の 2 か所に別々に書かれていて、すでに食い違っている。CODEOWNERS には `docs/memo/00_setup_prompt.md`、`docs/memo/01_platform_design.md`、`.npmrc`、`.yarnrc`、`.yarnrc.yml`、`.mcp.json`、`.vscode/`、`.devcontainer/` がない | 設計メモ 13.4 では、テンプレートのファイルを変える PR にコードオーナーのレビューを必須にすると書かれている。2 つの一覧が一致しているかを確かめるテストはない | `PLATFORM` から CODEOWNERS を生成するか、一致を確かめるテストを tests/hooks に追加する |
| Major | 保守性 | scripts/lib/policy.mjs:59,64,71,296,511 / scripts/lib/util.mjs:91 / .claude/hooks/post-edit.mjs:42 / scripts/lib/state.mjs:41,63 / scripts/lib/review-evidence.mjs:208-209 / scripts/lib/ids.mjs:159 | config.mjs には「パスの分類はここだけで定義する」と書かれているが、実際は分散している。`BUILD_OUTPUT`（policy.mjs）、`TREE_IGNORE`（util.mjs）、.gitignore は同じ一覧の重複。`GUARDED_DIRS` と `mentionedPaths` の正規表現も別々に場所を列挙している。`index.html`・`public/` を雛形とする扱いは policy.mjs の中に直接書かれていて、`TDD_EXEMPT` に入っていない。`src`・`e2e`・`public` も 6 ファイル以上に直接書かれている | 製品コードの置き場所を足す（例: `server/`）には、6 ファイル以上を同時に直す必要があり、直し漏れを見つけるテストもない。さらに `BUILD_OUTPUT` は使用箇所（59 行）より後ろ（71 行）で宣言されている | 製品・テスト・ビルド出力のディレクトリと、守るディレクトリの一覧を config.mjs に集め、ほかのファイルはそこから導き出す |
| Major | 保守性 | scripts/lib/state.mjs:58-65,161 / scripts/approve.mjs:14,48 / scripts/reject.mjs:11 / tests/hooks/helpers.mjs:36 | ゲートの順序と対応関係が、`STEPS` 以外にも直接書かれている。`computeArtifacts` にはステップ名の配列が並び、承認とレビュー記録の対応（approve.mjs:48）は `REVIEWS` とは別に書かれている。`['G0','G1','G2','G3']` も `HUMAN_GATES` があるのに 3 か所で書き直されている | ゲートやレビューを 1 つ足すと、`STEPS`、`computeArtifacts`、`REJECT_INVALIDATES`、`REVIEWS`、approve の対応表、`nextAction` の対応表をそろえて直す必要がある | 累積するハッシュの範囲は `STEPS` の並び順から導く。承認とレビュー記録の対応は `REVIEWS` に持たせる。`HUMAN_GATES` は import して使う |
| Major | 保守性 | scripts/lib/policy.mjs:492-507 | `commandWriteTargets`（post-edit が作成者の記録に使う）が `checkBash` のセグメント処理を簡略化して書き直したもので、すでに機能がずれている。`VAR=x`・`sudo`・`env` の除去、入れ子のシェル（`bash -c` など）、`~` の展開がない | このため `bash -c "..."` 経由の書き込みが activity.jsonl に残らず、相互レビューの「作成者 ≠ レビュアー」の照合が漏れる。この関数のテストもない | 1 つのセグメント解析関数を `checkBash` と共用し、テストを追加する |
| Major | 保守性 | scripts/ci.mjs 全体 / scripts/gate.mjs:65-73,84-91,100-115,130-140 / scripts/reopen.mjs / scripts/maintenance.mjs / scripts/approve.mjs:21-45 | テストのないスクリプト・分岐がある。ci.mjs（サーバー側の最後の防衛線）には結合テストが 1 本もない。gate.mjs の DESIGN_REVIEW、GREEN の合格、CODE_REVIEW、PLATFORM_REVIEW、RED 再オープン時の差分実行もテストされていない。approve / reopen / maintenance は判定（承認できるゲートか、ブランチ戦略が正しいかなど）が対話端末を前提にしたスクリプトの中に直接書かれていてテストできず、テストは「対話端末がないと止まる」ことしか確かめていない | review-checklist の RV-PF 保守性に「テストのないスクリプトはないか」とある。tests/hooks を検索すると、ci.mjs・reopen・maintenance への参照は対話端末の拒否のテストだけだった | 判定部分を lib に関数として出して単体テストする。ci.mjs は `makeProject` を使った結合テストを追加する |
| Major | 保守性 | .claude/agents/*.md（「書いてよい場所」）/ README.md:67-76 / scripts/lib/policy.mjs:88-97 | 役割ごとの書き込み権限が、`ROLE_WRITABLE`、各エージェント定義、README の表の 3 か所にあり、すでに食い違っている。`ROLE_WRITABLE` では test-designer と implementer に `scaffold` があるが、implementer.md と test-designer.md には雛形の記述がない | 設計メモ 0.6.2 は「エージェント定義には『どの skill を読むか』だけを書く」としている。エージェント定義にはコミット規約などのルールも skill から重複して書かれている | エージェント定義は skill への参照だけにし、権限は `ROLE_WRITABLE` を `npm run status` などで表示して確認する形にする |
| Major | 保守性 | scripts/lib/config.mjs:63 / scripts/lib/ids.mjs:11,128 / scripts/lib/trace.mjs:131 / scripts/lib/commitmsg.mjs:20 | レビュー ID と要求系 ID の正規表現が 4 か所にあり、内容が食い違っている。`ID_RE` と `RV_ID` は `PF` を含むが、`parseReview` と `reviewRefs` は `RV-\d{2}-\d{3,}` のため RV-PF-001 を ID として認識しない。commitmsg も独自の ID 種別の一覧を持っている | 同じ規則が重複していて、一部はもう追随していない | config.mjs（または ids.mjs）に ID の正規表現を 1 つだけ置き、ほかはそれを使う |
| Minor | 保守性 | scripts/gate.mjs:33-35,124 / scripts/wp.mjs:24,28,44,72,82-83,90 / scripts/pr.mjs:27 / scripts/lib/human.mjs:51-53 | サイクル番号の取り出し（`state.cycle.match(/^C-\d+/)[0]`）と、`.ai-dev/cycles/<サイクル>/wp/<WP>.json` などのパス組み立てが、各スクリプトで直接書かれている | state.mjs の `aiDev` は外から使えず、`scopeOf` も一部のスクリプトでしか使われていない | state.mjs に `cycleNum`、`wpRecordPath`、`cycleStateDir` を用意して共用する |
| Minor | 保守性 | scripts/wp.mjs:41-42,63-66 | 依存する WP を、`parseWorkPackages` を使わずに行の中の WP-ID をすべて拾って判定している（「依存」列以外に書かれた WP も依存として扱われる）。マージのロックは存在確認と書き込みが別の手順で、同時に実行されると両方が取れてしまう | 表の解析が重複している。ロックは複数の操作を 1 つの手順として行っていない | `parseWorkPackages` で「依存」列も返すようにする。ロックは `fs.openSync(lock, 'wx')` で作る |
| Minor | 保守性 | scripts/ci.mjs:80 / scripts/gate.mjs:46-51 | RV-03 だけ対象の照合を省くという例外が ci.mjs の中に直接書かれていて、gate（RED）では照合している。この扱いは `REVIEWS` の定義に入っていない | レビューの種類の性質が 1 か所で定義されていない | `REVIEWS['RV-03']` に `checkTargetsInCi: false` のような属性を持たせる |
| Minor | 保守性 | scripts/lib/config.mjs:10,14 / scripts/lib/trace.mjs:8-9,80 / .claude/skills/react-testing/SKILL.md:32 | テスト結果ファイルのパスが、`commands.testReport` の文字列、`RESULTS_FILE`、エラーメッセージ、skill に重複して書かれている。`testReport` を上書きすると、trace は固定のパスを読み続けて結果を見失う | 定数の重複 | 結果ファイルのパスを定数 1 つにし、コマンドはそれを埋め込んで組み立てる |
| Minor | 保守性 | .github/workflows/quality-gate.yml:5 | CI を動かすブランチ `[main, develop]` が、branching.mjs の `PRESETS` とは別に直接書かれている | ブランチ戦略を足したときに直し漏れが起きる | `pull_request` の `branches` 指定を外し、ci.mjs 側で統合ブランチかどうかを判定する |
| Minor | 保守性 | .claude/hooks/*.mjs（ルートの解決部分） | 「findRoot → CLAUDE_PROJECT_DIR → .ai-dev の存在確認」が 6 本のフックに重複していて、細部が違う（post-edit.mjs:18,31 は CLAUDE_PROJECT_DIR を使わず、.ai-dev も確認しない） | 重複した実装 | `_io.mjs` に `resolveRoot(input, absPath?)` を作って共用する |
| Minor | 保守性 | scripts/lib/review-evidence.mjs:22,28 | ブランチ名を安全な文字に置き換える正規表現が 2 か所に重複している | 重複 | `sanitizeBranch()` を作って共用する |
| Minor | 保守性 | scripts/lib/policy.mjs 全体（604 行） | 1 つのファイルに、書き込みの判定、シェルの字句解析、git / gh の判定が混ざっている | 長すぎるモジュールで、変更の影響範囲が読みにくい | policy-write / shell-parse / policy-command に分ける |
| Minor | 保守性 | .claude/agents/reviewer.md:10-16 / .claude/skills/pm-orchestration/SKILL.md:41-47 / .claude/commands/review-*.md / .claude/commands/test-design.md:14-20 / scripts/lib/review-evidence.mjs:52 | reviewer への 4 行の依頼形式とレビューの手順が、6 か所以上にほぼ同じ文面で書かれている | SSOT（設計メモ 0.6.2） | 形式は pm-orchestration だけに書き、コマンドからはそこを参照する |
| Minor | 保守性 | README.md:36-46 / docs/GETTING_STARTED.md:81-88 | 人間の承認手順の表が 2 つの文書に重複している | SSOT | どちらか一方に置き、もう一方からはリンクする |
| Minor | 保守性 | tests/hooks/branching-platform.test.mjs:75 / tests/hooks/helpers.mjs:36 | テストが観点の一覧や人間ゲートの一覧を書き写している | config を変えるとテストが黙ってずれる | `DEFAULT_CONFIG.reviewPerspectives` と `HUMAN_GATES` を import して使う |

観点外（ガードの抜け穴）: 1 行目の CODEOWNERS の欠けにより、設計メモ 13.4 の「CI 自体の書き換え」対策が `.npmrc`・`.mcp.json`・`.vscode/` や設計メモ本体には効いていない。

確認した範囲: 依頼の対象はすべて Read で開いた（プロジェクトルート C:\Users\User\.claude\projects\AI-Develorer 配下）。
