# Window A ドキュメント復元計画

対象リポジトリ: `/Users/tsudatakashi/tool-management-system02`
目的: 誤って RaspberryPiServer 用の内容に置き換わった `docs/requirements.md` を復元し、関連ドキュメントの整合を取る。

## ステップ

1. **`docs/requirements.md` の復元**
   - `git log -- docs/requirements.md` で履歴を調査し、Window A 用の内容が残っているコミットを特定。
   - その内容を復元し、必要に応じて最新情報（Pi4 クライアント方針など）を追記する。

2. **関連ドキュメントの整合確認**
   - `docs/docs-index.md`、`docs/documentation-guidelines.md`、`docs/AGENTS.md` など索引・ガイドライン・リンク集を見直し、復元内容に合わせる。
   - RUNBOOK やその他参照先（README 等）も必要に応じて修正する。

3. **棚卸し状況と記録の更新**
   - 復元完了後、`docs/docs-index.md` の棚卸し状況欄を更新し進捗を可視化する。
   - 変更点を `CHANGELOG.md` またはコミットメッセージに記録する。

4. **要件の最新化**
   - RaspberryPiServer への機能集約後に生じたタスク（Pi4 クライアント化、Socket.IO リトライ、物流タブ刷新、Playwright 追加など）を整理し、`docs/requirements.md` に反映する。
   - 必要に応じて `docs/e2e-plan.md` や `docs/right-pane-plan.md` へもタスク・優先度を転記する。

| ステップ | 内容 | 状況・メモ |
| --- | --- | --- |
| 1 | `docs/requirements.md` の復元 | ✅ 2025-10-31 |
| 2 | 要件の最新化 | ✅ 2025-10-31 |
| 3 | 索引・ガイドライン等の整合確認 | ☐ |
| 4 | 棚卸し状況と履歴の更新 | ☐ |

- ステップ4では、復元後の要件を最新状況に合わせて更新する。Pi5 側作業の影響や Pi4 クライアントの残課題を整理し、必要に応じて `docs/e2e-plan.md` や `docs/right-pane-plan.md` へも反映する。
