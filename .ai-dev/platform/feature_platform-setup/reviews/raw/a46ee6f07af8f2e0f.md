# RV-PF / ロジックの正しさ / a46ee6f07af8f2e0f

## 指示

レビュー番号: RV-PF
観点: ロジックの正しさ
対象: .claude, scripts, .githooks, .github, tests/hooks, docs/templates, docs/GETTING_STARTED.md, docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md, CLAUDE.md, README.md, .gitattributes, .gitignore, .ai-dev/config.json, package.json
基準: docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md

## 指摘（原文）

| 重大度 | 観点 | 対象（ファイル:行 または ID） | 内容 | 根拠 | 提案 |
|---|---|---|---|---|---|
| Major | ロジックの正しさ | scripts/gate.mjs:86-109、.claude/skills/react-testing/SKILL.md:30-32 | RED ゲートは `commands.test`（vitest）しか実行しない。E2E だけの TC（e2e/ のみ）では次のどちらかで誤判定になる。(a) vitest が e2e/ を除外している場合: 新しい TC が失敗していても vitest は成功するので、107 行で「テストが成功しました」と不合格になる。reopen 後に e2e だけを直した場合は、`npx vitest run "e2e/..."` が "No test files found" になり、108 行で「実行できない」と判定される。(b) 除外していない場合: Playwright の spec を vitest が読み込んで常に失敗するので、GREEN の test が永久に通らない。設定は RED でロックされるため、GREEN の段階で気づいても reopen が必要になる。スキルには e2e/ を vitest から除外する指示がない | チェックリストが境界として挙げている「E2E のみの TC」。設計メモ 4.3（RED は全 AC に TC）、GREEN と CI は e2e を別のコマンドで実行している | RED でも、e2e/ にロック対象のファイルがあれば `commands.e2e` を実行し、失敗の判定に含める。react-testing スキルに `test.exclude: ['e2e/**']` を明記する |
| Major | ロジックの正しさ | .claude/hooks/stop-gate.mjs:38-61 | implementer が終了するたびに、全テストと lint・typecheck・build・e2e（runGreen 一式）を、セッションの cwd のルートで実行して終了を止める。WP が複数あるとき（直列でも並列でも）、他の WP の RED でロックされた未実装のテストは必ず失敗するので、最後以外の implementer は担当を終えても 3 回止められ、担当外の実装に誘導される。worktree で作業する implementer には、メインツリーの結果が返る | implementer.md:30 の完了条件は「担当テスト・lint・型チェック」。gate.mjs:132-134 も、WP 単位では全テストを流せないと明記している。設計メモ 7.5 の内容は test / lint / typecheck で、build・e2e は含まない | WP ブランチ上か、ロック済みテストのうち未実装の WP のものがあるときは、担当テスト（所有パス）だけを実行するか、ブロックしない。少なくとも build・e2e は外す |
| Major | ロジックの正しさ | scripts/lib/review-evidence.mjs:219、scripts/ci.mjs:69,80、scripts/wp.mjs:84 | `git diff --name-only` は既定でリネームを検出し、移動先のパスしか出力しない。そのため次の 3 つをすり抜けられる。テンプレートのファイルを未分類の場所や docs/memo へ移動すると、元のファイルの削除が changedPlatformFiles に出ず、RV-PF が要求されない。feature/* で src/x を docs/memo/x へ移すと、製品コードの削除が範囲チェックを通る。WP で所有パス外のファイルを所有パス内へ移すと、所有パス外の削除が通る | チェックリスト「境界（ファイル削除）で誤判定しないか」。21 行目のコメント「削除だけの変更でもレビューが必要」と食い違う | 3 か所すべてに `--no-renames` を付ける（または `--name-status` で旧パスも拾う）。テストを追加する |
| Major | ロジックの正しさ | scripts/gate.mjs:101-105 と 111 | リファクタリングサイクルの分岐は、111 行の RED_REOPEN の削除より前に pass して break する。そのため (1) reopen 後は cmd が「変更したテストファイルだけ」に絞られたまま判定され、リファクタリングの基準（既存のテストがすべて成功）が一部のファイルでしか確認されない。(2) RED_REOPEN が残るので、次に RED が無効になったとき（G1 / G2 の差し戻し）も古い previousLock で絞り込みや「変更なし」の判定が続く | 110 行のコメント「再オープン記録の削除は pass() より前に行う」、103 行の「既存のテストがすべて成功している必要」 | リファクタリングのときは常に `config.commands.test` を実行する。RED_REOPEN の削除は、分岐の前（pass の直前、共通の位置）に移す |
| Major | ロジックの正しさ | .claude/hooks/tripwire.mjs:296-317 | AI のツールが長く動いている間に人間が `npm run approve` / `reject` を実行すると（承認ファイルの作成と commit で HEAD が動く）、Post では knownPairs（origin/main・origin/develop・Pre の時点の HEAD）にその承認ファイルがないので受け入れられず、315 行で削除される。commit は残るが、作業ツリーからは承認記録が消え、フェーズが戻る | 設計メモ 13.4 の 5 回目の表は「人間の承認・差し戻しが消えるのを防ぐ」を Pre の場合についてしか書いておらず、Post で消える場合は既知の限界にも書かれていない。人間が承認した方針「協調して使っても起きる不具合は直す」に当たる | Post で HEAD が動いたとき、`.ai-dev/approvals`・`cycles/*/approvals` のうち HEAD の commit の作成者・メッセージが approve / reject のものと一致する内容は受け入れる（または承認記録は削除せず警告にとどめる）。対応しない場合は README の既知の限界に追記する |
| Major | ロジックの正しさ | scripts/lib/util.mjs:78-81 | hashContent はすべてのファイルを UTF-8 の文字列として読んでからハッシュを取る。バイナリ（public/ の画像、src/assets の png など）では、不正なバイト列がすべて U+FFFD に置き換わるので、内容が違っても同じハッシュになりうる。CRLF の置換もバイナリにかかる。その結果、GREEN・G3 の承認後にバイナリを変えても無効にならない場合がある | チェックリスト「ハッシュによる無効化」 | 有効な UTF-8 でない（または NUL を含む）ファイルは、生のバイト列のままハッシュを取る |
| Minor | ロジックの正しさ | scripts/reopen.mjs:30、scripts/gate.mjs:84 | reopen の案内（「変更したテストが RED（失敗）になることを再度確認します」）と 84 行のコメントは、テストが失敗することを要求するように読める。しかし 99・107 行では reopen のとき relock が true になり、成功でも合格する（設計メモ 583 行はこちら）。変更したファイルだけに絞って実行する処理も、実質的には「実行できるか」の確認にしかなっていない | 設計メモ 13.4 の 5 回目の表（再ロック） | 案内とコメントを「実行できることを確認してロックし直す」に直す |
| Minor | ロジックの正しさ | scripts/lib/trace.mjs:139-142 | 同じ TC の結果が skipped → passed の順に来ると passed で上書きされる（failed だけが固定される）。`it.todo` などで一部が実行されていなくても「成功」になる | 141 行の直前のコメント「1 つでも失敗があれば failed」。traceProblems の green は「成功」を要求している | passed は、まだ結果がないときだけ設定する（passed 以外を優先する） |
| Minor | ロジックの正しさ | scripts/gate.mjs:138 | アクティブなサイクルがないときに `gate -- wp WP-xx` を実行すると、`a` が null のため `a.design` で TypeError になる。分かりやすいメッセージが出ない | 54 行で `a` は null になりうる | WP の分岐の先頭で state.cycle を確認して fail する |
| Minor | ロジックの正しさ | scripts/cycle.mjs:28 | `--refactor` に `refactor-x` という名前を渡すと、サイクル名が `refactor-refactor-x` になる | baseSlug の接頭辞を確認していない | baseSlug が `refactor-` で始まるときは、接頭辞を付け足さない |

確認した範囲: state（フェーズの算出・ハッシュ・差し戻しによる無効化）、gate、approve、reject、reopen、ci、cycle、wp、pr、review-evidence、ids、trace、run、branching、policy、debt、commitmsg、maintenance、human、stop-gate、post-edit、guard-agent、tripwire、テンプレート（01・02・03・review）、quality-gate.yml、.gitignore、package.json と、設計メモ 01（13.4 まで）を、ロジックの正しさの観点で見た。
観点外（1 行）: README・GETTING_STARTED・00_setup_prompt・CLAUDE.md・その他の Skills / commands / agents の大半と、tests/hooks の個々のテストは読んでいない（ドキュメントとの整合・保守性は未確認）。

関連ファイル:
- c:\Users\User\dev\AI-Develope\scripts\gate.mjs
- c:\Users\User\dev\AI-Develope\.claude\hooks\stop-gate.mjs
- c:\Users\User\dev\AI-Develope\scripts\lib\review-evidence.mjs
- c:\Users\User\dev\AI-Develope\scripts\ci.mjs
- c:\Users\User\dev\AI-Develope\scripts\wp.mjs
- c:\Users\User\dev\AI-Develope\.claude\hooks\tripwire.mjs
- c:\Users\User\dev\AI-Develope\scripts\lib\util.mjs
- c:\Users\User\dev\AI-Develope\scripts\reopen.mjs
- c:\Users\User\dev\AI-Develope\scripts\lib\trace.mjs
- c:\Users\User\dev\AI-Develope\scripts\cycle.mjs
- c:\Users\User\dev\AI-Develope\.claude\skills\react-testing\SKILL.md
