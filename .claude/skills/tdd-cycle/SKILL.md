---
name: tdd-cycle
description: テスト駆動開発（Red → Green → Refactor）の手順と禁止事項。テストを書く（test-designer）・実装する（implementer）ときに読む。
---

# TDD サイクル

## 全体の流れ（フェーズとゲート）
1. **Red**（test_design フェーズ / test-designer）: 受入基準ごとに、失敗するテストを書く → `npm run gate -- RED` でテストが失敗することを確認し、テストをロック
2. **Green**（implementation フェーズ / implementer）: テストを通す最小限の実装を書く
3. **Refactor**（implementer）: テストが通ったまま、重複や読みにくさを直す
4. `npm run gate -- GREEN`: README の GREEN の項目（テスト・lint・型・ビルド・E2E・トレーサビリティ）がすべて OK なら合格

## implementer の 1 タスクの回し方
1. 担当テストを実行して、失敗を確認する（`npx vitest run <担当パス>`）
2. 1 つのテストを通す最小限のコードを書く → 実行 → 通ったら次のテストへ
3. 全部通ったらリファクタリング → 再実行
4. lint・型チェック（`npm run lint`、`npm run typecheck`）
5. コミット（`feat(C-xxx): ...` + `Refs: DES-xxx, TC-xxx`）

## 禁止事項（フックで止められる）
- テストより先に製品コードを書く（対応する `*.test.*` がないファイルは作れない）
- ロック済みのテストを書き換えて通す
- `.skip` / `.only` / `xit` を使う
- テスト・ビルド設定をロック後に変える

## テストが間違っていると思ったら
- 自分で直さない。完了報告票の「懸念」に、どのテストがなぜ誤っているかを書いて PM に返す
- PM が人間に `npm run reopen -- RED "理由"` を依頼する
