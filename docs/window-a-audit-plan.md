# Window A ドキュメント棚卸し計画（未整備カテゴリ）

対象: tool-management-system02 リポジトリ
目的: `docs/docs-index.md` で未確認（⏳）となっているカテゴリを順番に棚卸しし、Pi5 集約後の構成と整合させる。

## ステップ

1. **RUNBOOK の棚卸し**
   - Pi5 サーバー連携後の運用手順（USB 同期、Socket.IO 再接続、トークン更新など）に合わせて更新する。
   - Window A 特有の手順（クライアントとしての設定・障害対応）を明確化する。

2. **right-pane-plan / e2e-plan の整備**
   - Pi5 連携後の右ペイン UI 改修計画、Playwright E2E 計画を最新化し、進捗と残課題を整理する。

3. **Data Source / Security / Checklist**
   - `docs/data-source-migration.md`、`docs/security-overview.md`、`docs/security-requirements-response.md`、`docs/checklists/daily-end-to-end.md` を確認し、現行構成に合わせて更新する。

各ステップの完了時には下表を更新し、索引・CHANGELOG に反映する。

| ステップ | 内容 | 状況 |
| --- | --- | --- |
| 1 | RUNBOOK の棚卸し | ✅ 2025-10-31 |
| 2 | right-pane-plan / e2e-plan の整備 | ✅ 2025-10-31 |
| 3 | Data Source / Security / Checklist の整備 | ✅ 2025-10-31 |
