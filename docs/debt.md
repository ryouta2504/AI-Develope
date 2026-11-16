# 技術的負債の台帳

> PM が管理する（フェーズに関係なく更新できる）。書式は `npm run debt -- --check` で検査される（CI も検査する）。
> 起票するもの: レビューで「保留」にした指摘（起票元に指摘 ID）、振り返りで見つけた構造上の問題、人間が挙げたもの。
> 解消は **リファクタリングサイクル**（`npm run cycle:new -- --refactor --debt DEBT-001 <名前>`）で行う。

- 重大度: 高（放置すると次の開発が止まる・事故につながる）/ 中 / 低
- 状態: 未対応 / 計画済（リファクタリングサイクルを G0 の計画に入れた）/ 解消 / 却下（理由必須）
- 最終列: 「解消」なら解消したサイクル ID、「却下」なら理由

| ID | 内容 | 場所 | 重大度 | 起票元 | 状態 | 解消サイクル / 理由 |
|---|---|---|---|---|---|---|
| DEBT-001 | パスの分類（製品・テスト・ビルド出力・守るディレクトリ）が config.mjs 以外にも直書きされている | policy.mjs / util.mjs / post-edit.mjs / state.mjs ほか | 中 | RV-PF-008 | 未対応 |  |
| DEBT-002 | 役割ごとの書き込み権限が ROLE_WRITABLE・エージェント定義・README の 3 か所にある。権限表を ROLE_WRITABLE から生成する | .claude/agents/*.md / README / policy.mjs | 中 | RV-PF-012 | 未対応 |  |
| DEBT-003 | approve・reopen・maintenance の判定が対話端末前提のスクリプト内にあり、単体テストできない（lib の関数にする）。gate の DESIGN_REVIEW・CODE_REVIEW・PLATFORM_REVIEW の結合テストも不足 | approve.mjs / reopen.mjs / maintenance.mjs / gate.mjs | 中 | RV-PF-011 | 未対応 |  |
| DEBT-004 | サイクル番号の取り出しと .ai-dev 配下のパス組み立てが各スクリプトに直書き（cycleNum・wpRecordPath を state.mjs に）。wp:start の依存判定が行内の全 WP-ID を拾う（parseWorkPackages で依存列を返す） | gate.mjs / wp.mjs / pr.mjs / human.mjs | 低 | RV-PF-032, RV-PF-033 | 未対応 |  |
| DEBT-005 | 「findRoot → CLAUDE_PROJECT_DIR → .ai-dev の存在確認」が 6 本のフックに重複している（_io.mjs に resolveRoot を作る） | .claude/hooks/*.mjs | 低 | RV-PF-037 | 未対応 |  |
| DEBT-006 | policy.mjs（約 650 行）が書き込み判定・シェルの字句解析・git / gh の判定を 1 ファイルに持つ（policy-write / shell-parse / policy-command に分ける） | scripts/lib/policy.mjs | 中 | RV-PF-039 | 未対応 |  |
| DEBT-007 | reviewer への 4 行の依頼形式とレビュー手順が 6 か所以上にほぼ同文で書かれている（pm-orchestration だけに書き、コマンドから参照する） | .claude/commands/review-*.md / agents / skills | 低 | RV-PF-040 | 未対応 |  |
| DEBT-008 | RED は 1 件でも失敗すれば合格で、新しい TC それぞれが失敗するかを確かめていない（結果 JSON から TC ごとに確認する） | gate.mjs | 中 | RV-PF-057 | 未対応 |  |
| DEBT-009 | 定義の重複: ID の正規表現・指摘の状態の読み方・ブランチ種別と許可範囲・src/e2e の直書き・ビルド出力の一覧・`.ai-dev` 配下のパスが複数ファイルに書かれている（config.mjs / ids.mjs / branching.mjs に集める）。DEBT-001・004 を含む | config.mjs / ids.mjs / policy.mjs / ci.mjs / state.mjs ほか | 中 | RV-PF 4 回目 -022, -024, -025, -026, -027 | 未対応 |  |
| DEBT-010 | checkBash と commandWriteTargets が、セグメント分割・cd の追従・入れ子シェル・~ の展開を別々に実装している（走査を 1 つのジェネレータにまとめる）。DEBT-006（policy.mjs の分割）と同時に行う | policy.mjs | 中 | RV-PF 4 回目 -023 | 未対応 |  |
| DEBT-011 | テストがレビューの回ごとのファイルに分かれ、補助関数（REPO・script・transcript）が各ファイルに複製されている（モジュール・ルール単位に並べ直し、helpers.mjs に集める） | tests/hooks/*.test.mjs | 低 | RV-PF 4 回目 -028 | 未対応 |  |
| DEBT-012 | 設計メモの本文が古いまま、13 章に「本文 → 現在」の差分表が 4 回分積み重なっている（本文を現状に書き直し、13 章は変更履歴だけにする） | docs/memo/01_platform_design.md | 中 | RV-PF 4 回目 -030, -020 | 未対応 |  |
| DEBT-013 | エージェント定義にプロセスのルール（コミット形式・TC の ID・受入基準）が複写されている。skill に一本化し、定義は「読む skill・書ける場所・返答の形式」だけにする。DEBT-002・007 を含む | .claude/agents/*.md | 低 | RV-PF 4 回目 -021 | 未対応 |  |
| DEBT-014 | implementer 終了時の GREEN 判定（stop-gate）が、担当 WP のテストで絞られていない（他の WP の RED のテストで 3 回ブロックされる）。worktree で作業した場合も自分の worktree で判定されない | .claude/hooks/stop-gate.mjs | 中 | RV-PF 4 回目 -010 | 未対応 |  |
| DEBT-015 | RED が E2E だけの TC（e2e/ の新しいテスト）を扱えない。DEBT-008（TC ごとの失敗確認）と同時に行う | gate.mjs | 中 | RV-PF 4 回目 -011 | 未対応 |  |
| DEBT-016 | レビュー記録の表が空でも合格する（raw の Critical・Major の件数と照合する）。ルート直下のテンプレートのファイルを削除すると PLATFORM_REVIEW を通せない（削除したパスを対象に指定できるようにする） | ids.mjs / gate.mjs / review-evidence.mjs | 中 | RV-PF 4 回目 -016, -017 | 未対応 |  |
| DEBT-017 | reviewer の Grep で `.ai-dev`・過去のレビュー記録を読んでも検出されない（Grep・Glob のパスも照合する）。「基準」の変更を照合しない。`npm run` 以外の迂回・文字列連結による requireHuman の迂回は既知の限界（README） | review-evidence.mjs / guard-agent.mjs | 中 | RV-PF 4 回目 -007, -009 | 未対応 |  |
| DEBT-018 | **最初のサイクルの前に、追加 PR で直す（RV-PF は変更したファイルだけが対象で軽い）**: ①RED が E2E だけの TC を扱えない（RED でも e2e を実行する）。react-testing スキルに `test.exclude: ['e2e/**']` を明記する（vitest が Playwright のテストを読み込んで GREEN が通らなくなる）②stop-gate を担当 WP のテストに絞る（他の WP の未実装テストで implementer が最大 3 回ブロックされる）③RED の再ロック（reopen・G1/G2 の差し戻しの後は成功でも合格）の説明を README・reopen の表示・gate のコメント・tdd-cycle スキル・test-designer に書く④done 後の再計画の手順（`git fetch origin` → `git switch -c plan/<日付> origin/<統合ブランチ>`）を /plan に書く（git pull は禁止）⑤ツールの長い実行中に人間が approve / reject すると、tripwire の Post が承認記録を削除する⑥**2 サイクル目の REQ_REVIEW が通らない（2 サイクル目に入る前に必ず直す）**: cycle:new が置く 02・03 のテンプレートの `REQ-001` / `AC-001-1` が、01 で続き番号に振り直した ID と合わず「未定義の ID」になる。未定義 ID の検査を、そのゲートで確定する文書だけに絞り（requirements は 01 のみ、design は 01・02）、テンプレートの例の行が参照を作らないようにする。2 サイクル目の REQ_REVIEW・DESIGN_REVIEW を通す結合テストを足す⑦wp:merge が、worktree の `git add` していない新しいファイルを削除する（`--untracked-files=all` にする。サイクルブランチの GREEN で検出はされる）⑧ハッシュで無効になった RED（上流の成果物を直接直した場合）も再ロックの対象にする⑨done フェーズで plan を書けるのを plan/* ブランチの上に限る | gate.mjs / stop-gate.mjs / tripwire.mjs / react-testing スキル / .claude/commands/plan.md ほか | 高 | RV-PF 6 回目 -011, -012, -015, -017, -018, -065, -066, -067, -068 | 計画済 |  |
| DEBT-019 | ガードの網羅漏れ（悪意のある迂回。既知の限界として却下・保留。CI の再検証・コードオーナーのレビュー・人間の PR 確認で止める）: 偽の `.ai-dev` ルート（`docs/memo/x/.ai-dev`）、拡張子のないスクリプト・`node_modules/.bin` の差し替え、git の長いオプションの省略形、`gh pr -R x merge` のフラグ前置、`git update-index` / `commit-tree`、`package.json` の scripts の tripwire 監視、`git diff` のリネーム検出（`--no-renames`）、バイナリのハッシュ。CI の `runs.jsonl` 再検証が実際には効かない点も含む | policy.mjs / tripwire.mjs / review-evidence.mjs / util.mjs / ci.mjs | 中 | RV-PF 6 回目 -001〜010, -013, -016 | 未対応 |  |
| DEBT-020 | リファクタリングサイクルの RED が reopen 後も絞り込みと古い RED_REOPEN を使う。tripwire の fail-open（外側の例外・`onFailure: block`）。HTML 図（docs/memo/ai-team-dataflow.html）が PM に自由に書けてレビュー対象外。エージェント定義のルール複写（DEBT-013）。構造の重複（policy.mjs の分割・セグメント走査・レビューの種類・パスの分類・ブランチ種別・ID の正規表現・記録の置き場所：DEBT-006, 009, 010）。`git commit` の失敗確認・stop-gate の例外の握りつぶし・WP の依存列・人間専用スクリプトの前提条件のテスト（DEBT-003, 004） | gate.mjs / tripwire.mjs / policy.mjs / config.mjs ほか | 中 | RV-PF 6 回目 -014, -019〜032 | 未対応 |  |
