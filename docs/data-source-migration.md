# Data Source Migration (Window A → RaspberryPiServer)

## Scope
- 移行対象: 生産計画 (`production_plan.csv`)、標準工数 (`standard_times.csv`)、所在一覧 (`part_locations`)、工程設定 (`station.json`).
- 目的: Window A ラズパイからサーバー (RaspberryPiServer) へデータ参照を集約し、USB / CSV 依存を段階的に廃止する。

## 現行構成まとめ
| UI / 機能 | データソース | 取得方法 (tool-management-system02) |
| --- | --- | --- |
| 生産計画テーブル | `/home/tools01/tool-management-system02/data/plan/production_plan.csv` | `load_plan_dataset('production_plan')` → `build_production_view()` |
| 標準工数テーブル | `/home/tools01/tool-management-system02/data/plan/standard_times.csv` | 同上 |
| 所在一覧テーブル | `PostgreSQL part_locations` (Window A ローカル) | `fetch_part_locations()` |
| 工程設定 (station) | `/var/lib/toolmgmt/station.json` | `load_station_config()` |

## 目標構成
1. RaspberryPiServer を唯一のデータ提供元とし、Window A は REST API / Socket.IO 経由で参照する。
2. USB 経由の CSV 取り込みはサーバー側 (`tool-ingest-sync.sh`) に集約し、取り込み直後に API で最新データを配信する。
3. 工程設定 (station) もサーバー管理に移行し、Window A UI からは REST API 経由で変更。

## 新規 API（案）
| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/v1/production-plan` | GET | 生産計画（納期順）を JSON 配列で返す。 |
| `/api/v1/standard-times` | GET | 標準工数（部品番号・工程名順）を JSON 配列で返す。 |
| `/api/v1/station-config` | GET/POST | 工程設定の取得・更新。既存の station.json を置き換える。 |
| `/api/v1/part-locations` | GET | 所在一覧を JSON で返す（既存 DB を再利用）。 |

- 認証: 既存の API トークン方式 (`Authorization: Bearer ...`) を継続。<br>
- レスポンス例については別途 OpenAPI 化を検討。

## 実装ステップ
1. **サーバー側 (RaspberryPiServer)**
   - 上記 API を Flask サービスに実装。
   - USB インポート後にサーバー側の CSV/DB を更新するパイプラインを整備。
   - station 設定の永続化場所を決定 (`/srv/rpi-server/config/station.json` など)。
2. **クライアント側 (Window A)**
   - `build_production_view()` を API 呼び出しへ抽象化（フェイルセーフとしてローカル CSV を残すか要検討）。
   - 所在一覧テーブルを `/api/v1/part-locations` から取得する非同期処理に置き換え。
   - station 設定 UI を新 API と連携させる。
3. **ドキュメント / テスト**
   - RUNBOOK / README / test-notes に新構成を反映。
   - pytest / CLI テストから API 経由の取得をカバー（モック or integration）。
4. **実機検証**
   - Window A で新 API に切り替え → Pi Zero → RaspberryPiServer → Window A の流れを確認。
   - 14 日試運転チェックリストを更新し、サーバー側ログとクライアントログを日次で照合。

## 依存・懸念点
- CSV 取り込みをサーバーへ移す際、USB / 既存スクリプトとの二重処理を避ける制御が必要。
- 駆動順序: DocumentViewer 先行 → 生産計画/標準工数 API → station 設定 → 完全切替。
- 既存バックアップ（tool-snapshot.sh、USB Export）にも新データが含まれるよう見直しが必要。

---
この計画に従い、サーバー API 実装 → Window A クライアント改修 → 実機検証を順次行う。
