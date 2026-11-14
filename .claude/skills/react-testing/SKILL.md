---
name: react-testing
description: React アプリのテスト方針。Vitest + React Testing Library + Playwright の使い分け、ユーザー視点のクエリ、モック方針、テスト名への TC/AC ID の入れ方、初期セットアップ手順。
---

# React のテスト方針

## テスト名に ID を入れる（トレーサビリティの自動検証に使う）
```tsx
it('[TC-001][AC-001-1] 入力して追加を押すと一覧の末尾に表示される', async () => { /* ... */ });
```

## 使い分け
| 種類 | ツール | 対象 |
|---|---|---|
| 単体 | Vitest | 純粋な関数・カスタムフック |
| 結合 | Vitest + React Testing Library | コンポーネント（ユーザー操作 → 表示） |
| E2E | Playwright | 主要な利用シナリオ（数本に絞る） |

## 書き方
- クエリは `getByRole` > `getByLabelText` > `getByText` の順に使う。`getByTestId` は最後の手段
- 操作は `@testing-library/user-event` を使う
- 実装の内部（state・関数呼び出し回数）ではなく、画面に見える結果を確かめる
- モックは外部境界（API・時刻・乱数）だけにする。自分たちのコンポーネントはモックしない
- 1 テスト 1 つの振る舞い

## 初期セットアップ（最初のサイクルの test_design で test-designer が行う）
- Vite の React + TypeScript 構成を用意する（`npm create vite@latest` は既存ファイルを上書きしうるので、一時フォルダに作って必要なファイルだけ移す）
- 開発依存: `vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test eslint typescript`
- `vite.config.ts` の `test` に `environment: 'jsdom'`、`setupFiles: ['src/test/setup.ts']`
- `src/test/setup.ts` に `import '@testing-library/jest-dom/vitest'`
- package.json の scripts（test / lint / typecheck / e2e）は基盤側で定義済み。変更はできない
- テスト・ビルド設定は RED でロックされる。test_design のうちに整えておく
