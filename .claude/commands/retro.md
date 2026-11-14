---
description: サイクルの振り返りを作成し、次の計画に反映する
---

1. 現在のサイクルの `.ai-dev/cycles/<サイクル>/history.jsonl`、reviews/、tasks/ を explorer に要約させる（数字: ゲートで止まった回数・差し戻し・指摘件数）
2. `docs/templates/retro.md` をもとに `docs/cycles/<サイクル>/retro.md` を書く
3. 「次のサイクルで変えること」を docs/improvements.md（改善候補・未承認）に追記する。承認済みのバックログ（docs/plan.md）に入れるには G0 の再承認が必要
4. 計画（docs/plan.md）の変更が必要なら、人間に提案する（変更すると G0 の再承認が必要）
