# Data Source Migration (Window A → RaspberryPiServer)

## Scope
- 移行対象: 生産計画 (`production_plan.csv`)、標準工数 (`standard_times.csv`)、所在一覧 (`part_locations`)、工程設定 (`station.json`)。
- 目的: Window A ラズパイから RaspberryPiServer へデータ参照を集約し、USB / ローカル CSV 依存を段階的に廃止する。

## 現行構成まとめ（2025-10-27 時点）
| UI / 機能 | 主データソース | 取得方法 (tool-management-system02) | フォールバック |
| --- | --- | --- | --- |
| 生産計画テーブル | RaspberryPiServer `/api/v1/production-plan` | `RaspiServerClient.get_plan_dataset("production_plan")` | `/var/lib/toolmgmt/plan/production_plan.csv` |
| 標準工数テーブル | RaspberryPiServer `/api/v1/standard-times` | `RaspiServerClient.get_plan_dataset("standard_times")` | `/var/lib/toolmgmt/plan/standard_times.csv` |
| 所在一覧テーブル | RaspberryPiServer `/api/v1/part-locations` | `RaspiServerClient.get_part_locations()` | Window A ローカル PostgreSQL `part_locations` |
| 工程設定 (station) | RaspberryPiServer `/api/v1/station-config` | `load_station_config()` / `save_station_config()` が REST を利用 | `/var/lib/toolmgmt/station.json` |

- `RASPI_SERVER_BASE` を未設定の場合は従来どおりローカル CSV / station.json / PostgreSQL を参照する。
- REST 通信でエラーが発生した場合、UI には「RaspberryPiServer: ...」の警告を表示しながら自動的にフォールバックする。

## 目標構成
1. RaspberryPiServer を唯一のデータ提供元とし、Window A は REST API / Socket.IO 経由で参照する。
2. USB 経由の CSV 取り込みはサーバー側 (`tool-ingest-sync.sh`) に集約し、取り込み直後に API で最新データを配信する。
3. 工程設定 (station) もサーバー管理に移行し、Window A UI からは REST API 経由で変更。

## 実装ステップ
1. **サーバー側 (RaspberryPiServer)** _[完了/継続]_
   - ✅ `/api/v1/production-plan`, `/api/v1/standard-times`, `/api/v1/part-locations`, `/api/v1/station-config` を Flask へ実装済み。
   - ⏳ USB インポート後にサーバー側の CSV/DB を更新するパイプラインを整備（ingest スクリプトに連携フックを追加）。
   - ✅ station 設定の永続化場所を `/srv/rpi-server/config/station.json` へ統一。
2. **クライアント側 (Window A)** _[完了]_
   - `build_production_view()` で REST を優先し、取得失敗時はローカル CSV へフォールバック。
   - 所在一覧テーブルを `/api/v1/part-locations` から取得し、Socket.IO に加えて 20 秒間隔の REST 更新を維持。
   - station 設定 UI を `/api/v1/station-config` と連携させ、ローカル station.json はバックアップ用に限定。
3. **ドキュメント / テスト** _[進行中]_
   - README / RUNBOOK / requirements に REST 連携方法とフォールバック運用を反映。
   - pytest へ REST 成功／失敗のモックテストを追加済み。実機手順は test-notes へ追記予定。
4. **実機検証**
   - Window A ↔ RaspberryPiServer ↔ Pi Zero のエンドツーエンド検証を 14 日運用チェックに組み込み、REST 失敗時のログ採取と復旧手順を確立する。

## 依存・懸念点
- サーバー側 ingest を REST 連携へ切り替える際、USB と API の二重更新を防止する制御が必要。
- RaspberryPiServer の障害時はフォールバックで継続できるが、復旧判断と切り戻しフローを RUNBOOK に明示する。
- 既存バックアップ（tool-snapshot.sh、USB Export）に REST でのみ存在するデータが漏れないよう、サーバー側のファイル/DB もバックアップ対象へ追加する。
- API トークンのライフサイクル（発行・更新・監査）を RaspberryPiServer / Window A の両側で同期させる。

---
残タスクはサーバー側 ingest パイプラインと長期運用時の監視・バックアップ整備に集中させる。
