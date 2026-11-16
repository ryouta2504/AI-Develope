# RV-PF / ドキュメントとの整合 / a1c83a6c73aba5f6e

## 指示

レビュー番号: RV-PF
観点: ドキュメントとの整合
対象: .claude, scripts, .githooks, .github, tests/hooks, docs/templates, docs/GETTING_STARTED.md, docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md, CLAUDE.md, README.md, .gitattributes, .gitignore, .ai-dev/config.json, package.json
基準: docs/memo/00_setup_prompt.md, docs/memo/01_platform_design.md

## 指摘（原文）

| 重大度 | 観点 | 対象（ファイル:行 または ID） | 内容 | 根拠 | 提案 |
|---|---|---|---|---|---|
| Critical | ドキュメントとの整合 | .claude/hooks/tripwire.mjs:32, 77-83, 289-311 / scripts/approve.mjs:67-70 / scripts/reject.mjs:38-42 / README.md:40-48, 104 / docs/memo/01_platform_design.md:422-426, 556-557 | README と設計メモは「人間がターミナルで `npm run approve` / `reject` を実行すれば、承認・差し戻しが記録されて AI が続きを進める」と説明している。しかし tripwire は承認記録（`.ai-dev/approvals`、`.ai-dev/cycles/*/approvals`）を監視しており、ツール実行の合間に人間が書いてコミットした記録も元に戻す。その結果、次のツール実行で新しい G0〜G3.json は削除され、差し戻しの記録は承認済みの内容に戻る。HEAD が動いたときに受け入れるのは「main / develop / 基準を取った時点の HEAD にある blob」だけで、承認コミットで新しく作られた blob はどれにも含まれない。人間の承認を区別する仕組みはなく、文書にもこの挙動の説明がない（README:104 は「手で直した分も戻される」とだけ書いている） | tripwire.mjs:241 の knownBlobs は main・develop・origin/*・baseHead だけを見る。298 行目で受け入れられなかった新規ファイルは 307-310 行目で rmSync される。approve.mjs:67 は承認記録を書き、70 行目でコミットする。tests/hooks/tripwire.test.mjs には「人間の approve / reject の後も記録が残る」ことを確かめるテストがない（39-47 行・86-95 行は偽造を戻すテストだけ） | 人間専用スクリプトが書いた後に tripwire の基準を更新する（例: 承認スクリプトが基準の世代を作り直す）か、承認コミットを受け入れる条件を設計して文書化する。「approve の後の最初のツール実行で記録が残る」ことと「reject の後に承認済みへ戻らない」ことの回帰テストを追加する |
| Major | ドキュメントとの整合 | .claude/hooks/stop-gate.mjs:38-54 / .claude/agents/implementer.md:29-31 / docs/memo/01_platform_design.md:569 / .claude/commands/implement.md:9-10 | implementer の完了条件は「担当テスト・lint・型チェック」と書かれている。設計メモ 13.4（RV-PF 4 回目）は「他の WP の未実装のテストを含むため全テストは流さない」と方針を決めている。ところが stop-gate は implementer の終了時に、全テスト・lint・型・ビルド・E2E（runGreen の全項目）を実行し、失敗すると終了をブロックする。直列実装（並列なし、または WP が 1〜2 個）で WP-01 を担当した implementer は、RED でロックされた WP-02 の未実装テストが原因で最大 3 回ブロックされる。README:107 もこの挙動との違いに触れていない | stop-gate.mjs:54 は `runGreen(root, config, { timeoutMs })` で、testFiles も skip も指定していない。gate.mjs:137-139（WP の GREEN）は所有パス内のテストだけを実行している | stop-gate の確認を、担当 WP の所有パス内のテスト（gate wp と同じ範囲）に揃えるか、implementer.md・README・設計メモの完了条件を実装に合わせて書き直す |
| Minor | ドキュメントとの整合 | scripts/gate.mjs:129-139 / docs/memo/01_platform_design.md:569 | 設計メモとコメントは、WP の GREEN を「所有パス内のテストと lint だけ」と説明している。しかし実装は skip に typecheck と e2e しか指定していないため、build（既定の green に含まれる）も実行される。未実装の他の WP を import していると、ビルドが落ちうる | gate.mjs:139 `skip: ['typecheck', 'e2e']`、config.mjs:24 `green: ['test','lint','typecheck','build','e2e']` | build も skip するか、文書に build を含めると明記する |
| Minor | ドキュメントとの整合 | .claude/skills/tdd-cycle/SKILL.md:12 / .claude/commands/implement.md:17 / README.md:62 | GREEN の項目が複数の文書に写されている（SSOT 違反）。実際の項目は `config.green`（.ai-dev/config.json で変えられる）で決まる。さらに、tdd-cycle と implement.md の「README の GREEN の項目（…トレーサビリティ）」は、README:62 の書き方（「全 TC に成功の実行結果」）と一致していない | config.mjs:24、gate.mjs:114-117 | 項目は README か `npm run status` などの 1 か所にまとめ、他の文書からは参照だけにする |
| Minor | ドキュメントとの整合 | .claude/hooks/tripwire.mjs:346 / .claude/settings.json:27-28, 49-50 / docs/memo/01_platform_design.md:513, 556 | 設計メモには「tripwire の内部エラーは fail-closed（exit 2）」「ガード系には onFailure: block」とある。しかし syncWithBase の外で起きた例外は `main().catch(() => process.exit(0))` で通過させており、settings の tripwire にも onFailure: block が付いていない | 記載の行のとおり | 外側の catch も exit 2 にし、settings に onFailure: block を付けるか、設計メモに例外を明記する |
| Minor | ドキュメントとの整合 | scripts/ci.mjs:68 | ステップ名が「plan/* の変更範囲（計画と G0 の承認記録のみ）」のままになっている。実際に許可しているのは、改善候補・history.jsonl・終わったサイクルの activity.jsonl を含む範囲（53 行目・71 行目、設計メモ:572・575） | ci.mjs:53, 71 | ステップ名を PLAN_ALLOWED に合わせる |
| Minor | ドキュメントとの整合 | .claude/commands/cycle-new.md:7 | 同じ手順の中に「統合ブランチを最新にする」と「手動の切り替えは不要」が並んでいて矛盾して読める。最新にする手段も書かれていない（git pull はフックで禁止。policy.mjs:655） | policy.mjs:654-659、cycle.mjs:61 | 「cycle:new が統合ブランチを fetch するので操作は不要」の一文にする |
| Minor | ドキュメントとの整合 | docs/memo/01_platform_design.md:362-366, 410-412, 424, 443-453 | 本文のうち、13 章の置き換え表に載っていない古い記述が残っている。①PR 本文の「テスト結果（件数・カバレッジ）」: pr.mjs:66 は合否と秒数だけ。②7.3 の注入形式（`G1=承認済 G2=未`、「許可:」の行）: statusview.mjs:22-26 と形式が違う。③7.6 の承認記録の「レビュー記録の参照」: approve.mjs:67 に該当する項目はない。④9 章の Skills に pm-orchestration がない | 記載の各行 | 13.4 の表に追記するか、本文を直す |
| Minor | ドキュメントとの整合 | docs/memo/01_platform_design.md:535, 587 | 「ステータス: 承認待ちではなく RV-PF で相互レビュー中」が 13.4 の中で 2 回書かれている（同じ文書内での重複） | 記載の行 | 片方を削除する |
| Minor | ドキュメントとの整合 | docs/templates/task.md:1 / .claude/skills/pm-orchestration/SKILL.md:15 / docs/memo/01_platform_design.md:67 | タスク票の ID・ファイル名の書き方が 3 か所でそれぞれ違う（`T-{{サイクル番号}}-{{連番}}` / `tasks/T-<番号>.md` / `T-C001-012`） | 記載の行 | 1 つの形式に揃える |

観点外: 1 件目（tripwire が人間の承認・差し戻しを元に戻す）は、整合の問題であると同時に、ロジックの正しさとしても Critical です。

確認した範囲: 依頼の対象（.claude・scripts・.githooks・.github・tests/hooks・docs/templates・GETTING_STARTED・00/01 の設計メモ・CLAUDE.md・README・.gitattributes・.gitignore・.ai-dev/config.json・package.json）はすべて Read で開きました。
