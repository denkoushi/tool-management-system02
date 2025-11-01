# 要件とロードマップ

この文書は tool-management-system02 プロジェクトの機能要件、優先順位、未対応タスク、および決定事項を一元管理します。運用手順（RUNBOOK）や個別計画（right-pane-plan）と併用し、情報が分散しないようにしてください。

## 1. 現状の優先度（2025-10-31 更新）

- ✅ **右ペイン UI レイアウト崩れの復旧**
  - Pi5 連携後に崩れていた CSS/DOM を修正済み。Pi4 ブラウザ（1080px 幅）で要領書・所在一覧・構内物流の各タブが正常表示されることを実機で確認した。
  - 証跡: 2025-10-31 Pi4 実機確認（ブラウザハードリロード後も再発なし）。
- ☐ **Pi5 サーバー連携後のクライアント最適化**
  - `RASPI_SERVER_BASE` / `UPSTREAM_SOCKET_BASE` を実ホスト名に合わせ、Window A の systemd drop-in を最新化する。
  - Socket.IO 断検知・リトライ表示を整備し、右ペインの状態表示が実際の接続状況と一致するようにする。
  - 2025-10-31: Pi5 サービス停止中は `OFFLINE` 表示のままで再接続中表示にならず。`reconnect_attempt` で状態更新する修正が未完。 → 再接続イベントを manager 監視で補正済み。Pi4 実機での再検証が必要。
  - 2025-10-31: ステータスチップの再接続表示・エラー更新をコード反映済。Pi4 実機での動作確認と RUNBOOK 追記が未完。
- ☐ **構内物流・所在一覧 UI の整合**
  - Pi5 `/api/logistics/jobs` のレスポンスに合わせて物流タブの列定義とステータス表示を調整する。
  - DocumentViewer 連携イベントを再テストし、所在一覧のハイライト挙動を確認する。
- ☐ **E2E テスト整備（Playwright）**
  - `docs/e2e-plan.md` に沿って、スキャン→所在反映→Viewer 自動表示までのシナリオを Playwright で実装する。
  - ローカル `.env.test` と Pi5 テスト環境で実行できる npm スクリプトを整備する。
- ☐ **ドキュメント更新と棚卸し**
  - README／RUNBOOK／`docs/right-pane-plan.md` を Pi5 集約後構成に合わせて更新する。
  - `docs/docs-index.md` の棚卸し状況を最新化し、未整備カテゴリをゼロにする。
- ☐ **API トークン／セキュリティ運用の整理**
  - ステーション別トークン運用 (`scripts/manage_api_token.py`) を棚卸しし、Pi5 と同等ポリシーに統一する。
  - `docs/security-overview.md` へ現状運用と Pi5 との整合を追記する。

## 2. バックログ

### 2.1 工程設定関連
- 設定編集 API・管理 UI の追加（工程リスト CRUD、初期化機能の整備）。
- station.json 欠損・破損時の自動復旧、UI 上でのエラーメッセージ改善。

### 2.2 Pi5 クライアント連携の補強
- DocumentViewer iframe のフォールバックメッセージ／再接続ハンドリングの改善。
- Window A 側の `tool-dist-sync.sh` から Pi5 への DIST USB エクスポート判定を行い、最新データであることを表示。RUNBOOK の USB 章と合わせて手順化する。
- Pi5 の `/api/logistics/jobs` 仕様変更に追従し、旧 local DB 参照コードを削除。UI 表示ロジックをサーバー API ベースへ統一する。
- ハンディリーダとの疎通確認コマンド（`scripts/socketio_listener.py` 等）を Window A でも実行できるようにし、トラブルシュート手順を RUNBOOK へ追記する。

### 2.3 コンテナ運用（Docker）
- Raspberry Pi 上でのコンテナ統一運用を検討。アプリ・PostgreSQL・Grafana を Docker 化すると再現性が高まる一方、端末リソースを圧迫するため構成を整理する。
- 単体端末で完結する構成（Pi 内に Docker すべて）と、DB などを外部ホストへ集約する構成のメリット／デメリットを比較。段階的な移行方針を策定する。

### 2.4 API トークン運用
- トークン管理スクリプトの高度化（複数トークン対応、履歴管理）。
- 初期セットアップ手順への統合、GUI 連携の検討。

### 2.5 ドキュメント／サポート
- 初期構築ガイドの詳細化（CLI コマンド、設定ファイル例、障害対応）。
- Decision ログの要約版と相互参照の維持。 
- スクリーンショット・図版の追加（UI 安定後）。

### 2.6 テスト／CI
- Playwright E2E に合わせたテストデータとモック API の整備。
- RaspberryPiServer との結合を前提にしたシェルスモーク／pytest の見直し。
- GitHub Actions 等で lint/unit を自動化するか検討し、少なくともローカルで `npm run lint` `pytest` を実行するガイドを README に追記する。

## 3. 決定事項（抜粋）

| テーマ | 内容 | 参照 |
| --- | --- | --- |
| DocumentViewer 工程設定 | `station.json` は Pi5 の設定値に合わせ、Window A ではクライアントとして工程を選択する。環境変数 `STATION_PROCESS` は初期値フォールバック。 | RUNBOOK 3.7 |
| バーコード連携 | 移動票バーコードは「部品番号→製造オーダー番号」。DocumentViewer から postMessage で連携し、左ペインでハイライト。 | RUNBOOK 3.10 / templates/index.html |
| データ配布方針 | USB DIST は Pi5 から配布。Window A は受け取り側として `tool-dist-sync.sh` を実行し、同期完了メッセージを UI に表示する。 | RUNBOOK 3.8 |
| API トークン運用 | Pi5 と同一方針でステーション別トークンを発行。`/etc/toolmgmt/api_token.json` に保存し、監査ログへ station_id を残す。 | RUNBOOK 3.4 |

## 4. 完了済み主要項目

- ZIP 版からの復旧ベースライン構築（Flask + Socket.IO、Docker/Postgres、systemd 連携）。
- USB マスターデータ同期と DocumentViewer importer の連携。 
- API トークン認証・監査ログ、セキュリティ対策（UFW、SSH 鍵化、fail2ban 等）。
- DocumentViewer 右ペイン UI、工程設定 UI の最新化。 
- OnSiteLogistics（ハンディリーダ）から `POST /api/v1/scans` を受け付け、`part_locations` upsert と `Socket.IO` ブロードキャストを実装。`feature/scan-intake` ブランチで稼働し、RUNBOOK 3.4 に連携手順を整備。
- Pi5 側サーバーで DocumentViewer / logistics API が稼働し、Window A はクライアント運用へ移行。Pi4 では UI 表示と設定操作のみを提供する構成を確認済み。

## 5. 運用上のメモ

- セキュリティ関連の詳細は `docs/security-overview.md` と `docs/security-requirements-response.md` を参照。
- DocumentViewer 右ペインの詳細な作業計画は `docs/right-pane-plan.md` に記載。
- ドキュメントを更新する際は `docs/documentation-guidelines.md` に従い、情報の所在が重複しないように整理する。
- エージェント・自動化作業の基本指示は `docs/AGENTS.md` を参照。
