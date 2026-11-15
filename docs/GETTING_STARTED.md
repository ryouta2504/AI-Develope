# 導入ガイド

このテンプレートを使って新しいプロジェクトを始める人向けの手順です。初めての人は上から順に進めてください。仕組みの詳しい説明は [README.md](../README.md) にあります。

## 1. 必要なもの

| もの | 確認方法 | 入れ方 |
|---|---|---|
| Node.js 22 以上 | `node -v` | https://nodejs.org/ |
| Git | `git --version` | https://git-scm.com/ |
| GitHub CLI | `gh --version` | `winget install GitHub.cli`（入れたら VSCode を再起動） |
| Claude Code | VSCode の拡張機能、または `claude --version` | VSCode の拡張機能から入れる |
| VSCode | - | https://code.visualstudio.com/ |

## 2. 置き場所を決める

プロジェクトは **`C:\Users\<あなたの名前>\dev\` のような普通のフォルダ**に置いてください。

> `C:\Users\<名前>\.claude\` の中には置かないでください。Claude Code はこのフォルダを自分の設定フォルダとして扱うため、ファイルを編集するたびに確認が出たり、AI の書き込みが拒否されたりします。

## 3. プロジェクトを作る

### 方法 A: GitHub の「Use this template」（おすすめ）
1. テンプレートのリポジトリを GitHub で開き、「Use this template」→「Create a new repository」
2. 自分のプロジェクトのリポジトリ名を付けて作成する
3. 手元に取ってくる
   ```powershell
   cd C:\Users\<あなたの名前>\dev
   gh repo clone <あなたのアカウント>/<リポジトリ名>
   cd <リポジトリ名>
   ```

### 方法 B: コマンドで作る
```powershell
cd C:\Users\<あなたの名前>\dev
gh repo create <リポジトリ名> --template ryouta2504/AI-Develope --private --clone
cd <リポジトリ名>
```

> 「Use this template」が表示されない場合は、テンプレート側のリポジトリで Settings → General →「Template repository」にチェックを入れてもらってください。

## 4. 初期設定（1 回だけ）

**コマンドは必ずプロジェクトのフォルダ（`package.json` がある場所）で実行してください。** 別のフォルダで実行すると `npm error ENOENT ... package.json` になります。

```powershell
npm run setup     # git フック（コミット規約の検証）を有効にする
gh auth login     # GitHub CLI にログイン（GitHub.com → HTTPS → ブラウザでログイン）
npm run doctor    # 環境チェック。⚠ や ❌ があれば、表示された直し方に従う
```

続いて、次の 2 つを設定します。

1. **`.github/CODEOWNERS` の担当者を書き換える**
   テンプレートでは `@ryouta2504` になっています。自分のプロジェクトでテンプレートの変更をレビューする人の GitHub アカウントに変えて、コミットしてください。`npm run doctor` で確認できます。
2. **GitHub のブランチ保護（リポジトリの管理者が設定）**
   Settings → Branches（または Rules → Rulesets）で、main（git-flow-lite を使うなら develop も）に次を設定します。
   - Require a pull request before merging（直接 push を禁止）
   - Require status checks to pass: `gate`（quality-gate）
   - Require review from Code Owners

> 1 人で運用している場合、GitHub では自分の PR を自分で承認できません。コードオーナーのレビューを必須にすると、管理者のバイパスでしかマージできなくなります。その場合は「テンプレートの変更を含む PR は、差分を自分で確認してからバイパスする」と決めておいてください。

## 5. 最初の 1 サイクルを回す

1. **VSCode でプロジェクトのフォルダを開く**（ファイル → フォルダーを開く）。ターミナルも最初からこのフォルダで開くようになります
2. **Claude Code を開いて `/pm` と入力する**。PM（AI のリーダー）が状態を確認し、次にやることを始めます
3. 最初は **開発計画（/plan）** です。PM が次のことを質問します。推奨案が先頭に表示されるので、迷ったらそれを選んでください
   - 作りたいもの・目的
   - 開発手法（ウォーターフォール / MVP / スクラム）
   - ブランチ戦略（github-flow / git-flow-lite）、マージ方式、並列実装の有無
4. PM が `docs/plan.md` と PR を作ったら、内容を確認して **ターミナルで** 承認します
   ```powershell
   npm run approve -- G0
   ```
   表示に従って `APPROVE G0` と入力し、そのあと GitHub で plan の PR をマージします
5. もう一度 `/pm` と入力すると、サイクルが始まります。あとは PM が止まるたびに、言われたものを確認して承認します

## 6. 役割ごとの使い方

### 承認する人（プロダクトオーナー・リーダー）
| PM が止まったとき | 見るもの | コマンド |
|---|---|---|
| G0 開発計画 | docs/plan.md | `npm run approve -- G0` → plan PR をマージ |
| G1 要求定義 | docs/cycles/C-xxx/01_requirements.md と reviews/RV-01 | `npm run approve -- G1` |
| G2 設計 | 02_design.md と reviews/RV-02 | `npm run approve -- G2` |
| G3 最終 | PR の差分、CI（G3 以外が合格）、実際に動かした結果 | `npm run approve -- G3` → CI が合格したら PR をマージ |
| 直してほしいとき | - | `npm run reject -- G2 "理由"` |

- 承認・差し戻しは **人間がターミナルで打つ** コマンドです。AI には実行できません
- 承認したあとに成果物が変わると、承認は自動で取り消されます（もう一度確認が必要になります）
- 迷ったら `npm run status` で、いまどこにいて次に何をするかが表示されます

### 開発に参加するメンバー
- 基本は Claude Code で `/pm` と話すだけです。コードやテストは AI の担当者（サブエージェント）が書きます
- 自分で直接ファイルを編集してもかまいませんが、承認済みの成果物を変えると承認が取り消されます。変えたいときは承認者に相談してください
- テンプレート自体（`.claude/`、`scripts/` など）を変えたいときは、承認者に `npm run maintenance -- on` を頼み、`feature/*` ブランチで作業します。変更は RV-PF（AI の相互レビュー）とコードオーナーのレビューを通ります

## 7. 困ったとき

| 症状 | 原因と対処 |
|---|---|
| `npm error ENOENT ... package.json` | プロジェクトのフォルダ以外で実行しています。`cd <プロジェクトのフォルダ>` してから実行してください |
| `gh` が見つからない（`用語 'gh' は認識されません`） | 入れた後に VSCode を再起動していません。再起動するか、`& "C:\Program Files\GitHub CLI\gh.exe" auth login` のようにフルパスで実行してください |
| PowerShell で `"C:\...\gh.exe" auth login` が動かない | 先頭に `&` を付けてください（`& "C:\...\gh.exe" auth login`） |
| AI が `[GATE] ...` と言って止まった | 品質ゲートが働いています。表示された「次の手順」が正しい進め方です。理由に納得できなければ `npm run status` を見て、承認者に相談してください |
| フックが効いていないように見える | `.claude/settings.json` の変更は Claude Code を開き直すまで反映されません。VSCode を再起動してください |
| ファイル編集のたびに確認が出る / 書き込みが拒否される | プロジェクトが `~/.claude` の中にあります。`C:\Users\<名前>\dev\` などへ移してください |
| `npm run approve` が「人間がターミナルから直接実行する必要があります」と出る | Claude Code のターミナル経由ではなく、VSCode のターミナル（または PowerShell）で自分で実行してください |
| 何をすればいいかわからない | `npm run status`（いまの状態と次の手順）、`npm run doctor`（環境チェック）、Claude Code で `/pm` |
