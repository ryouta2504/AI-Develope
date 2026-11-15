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
