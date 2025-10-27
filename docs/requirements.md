# 要件とロードマップ

この文書は tool-management-system02 プロジェクトの機能要件、優先順位、未対応タスク、および決定事項を一元管理します。運用手順（RUNBOOK）や個別計画（right-pane-plan）と併用し、情報が分散しないようにしてください。

## 1. 現状の優先度

1. **工程設定 UX / 保守性強化**  
   - RaspberryPiServer 経由の工程設定 REST を安定運用し、エラー時の UI 表示と監査ログを整備する。  
   - DocumentViewer への即時反映と設定エラー時の復旧手順を最新化。
2. **API トークン運用の高度化**  
   - 複数トークン管理、履歴保持、UI からの再発行を検討。  
   - 初期セットアップ手順への統合、監査ログの整備。
3. **データ配布（USB + リモート）の両立**  
   - USB 運用を維持しつつリモート API を設計。  
   - 認証やエラー表示、UI メッセージの整理。
4. **テスト戦略の拡張**  
   - pytest / シェルスモークで USB・工程設定などの最小検証を自動化。  
   - CI 導入に向けた準備。
5. **ドキュメント整備の継続**  
   - 初期構築ガイドやトラブルシュートを最新化。  
   - Decision Log を本書に集約しリンク構造を保つ。
6. **監視・バックアップ体制の強化**  
   - PostgreSQL／サービスの死活監視と、バックアップ計画の標準化を進める。  
   - API 仕様（エンドポイント / エラー体系）を OpenAPI 等で明文化し、拡張時の互換性を担保する。
7. **ネットワーク移行準備**  
   - 工場内 Wi-Fi への移行に向け、IP/DNS 設定・TLS 化・アクセスポイント配置・再送テストを標準化する。ハンディリーダが再送キューと Socket.IO を問題なく利用できるか、現地で検証する手順を RUNBOOK に加える。

## 2. バックログ

### 2.1 工程設定関連
- 設定編集 API・管理 UI の追加（工程リスト CRUD、初期化機能の整備）。
- station.json 欠損・破損時の自動復旧、UI 上でのエラーメッセージ改善。

- RaspberryPiServer の REST API を Window A から利用開始したため、USB→サーバー取り込みパイプライン（tool-ingest-sync）とキャッシュ更新トリガーを整備する。失敗時はダッシュボードへ警告を表示し、RUNBOOK へ復旧手順を追加する。 
- 認証・監査：サーバーへの Bearer トークンを `RASPI_SERVER_API_TOKEN` / `api_token_store` で統一管理し、アクセス失敗を監査ログに記録する。
- USB と REST 併用フェーズの運用手順更新（RUNBOOK/README のエラー確認手順、日次点検リスト）。
- 中央ストレージ（PostgreSQL など）への集約検討。PDF を含むすべてを DB 化するのではなく、まず CSV メタ情報から段階的に移行し、ネットワーク障害時の復旧手順や認証強化を含む運用設計を策定する。移行期間中の二重管理リスクやセキュリティ要件を踏まえて段階的に進める。
- サイネージ向けに `part_locations` を提供するエンドポイント／Socket.IO チャネルの公開方法とキャッシュ戦略を決定し、Window C の端末構成と合わせて実装する。
- 所在一覧 UI はヘッダ内トグル（要領書⇔所在）と Socket.IO / 20 秒間隔の REST 更新を備える。今後は Window C への引き渡し方法とスケーラビリティを検討。
- アイテム番号のみに依存しない視認性向上のため、部品番号をキーに部品名称・顧客名・製品型番など外部マスタ（生産管理システム）と連携するリレーション設計を進める。データ同期手段、キャッシュ方針、更新頻度、セキュリティ要求を整理する。
- PostgreSQL は最新所在のみ upsert する構造であれば数十万件規模でも性能に余裕がある。`order_code` 主キーで高速参照できる一方、履歴テーブルを追加する際は `updated_at` などのインデックス設計と Raspberry Pi の I/O 制約（必要なら外部 DB）を併せて検討する。
- USB ベースの要領書／工具マスタ配布は段階的に API 連携へ移行する。ハンディリーダで構築した HTTP + 再送基盤やトークン運用を流用し、ETL/API 設計・キャッシュ戦略を整備する。
- API/DB 仕様はバージョン管理されたドキュメント（OpenAPI など）として公開し、拡張時の互換性を担保。変更点は RUNBOOK / docs に即時反映する。

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
- テストデータセットと USB モックの整備。 
- Raspberry Pi 向け pytest / シェルテストの追加。 
- GitHub Actions 等で lint/unit の一部を自動実行できるようにする。

## 3. 決定事項（抜粋）

| テーマ | 内容 | 参照 |
| --- | --- | --- |
| DocumentViewer 工程設定 | 各ラズパイに station.json を配置し、UI で工程選択。環境変数 `STATION_PROCESS` は初期値フォールバック。設定変更時は JSON 更新→通知→再読込で運用。 | RUNBOOK 3.7 |
| バーコード連携 | 移動票バーコードは「部品番号→製造オーダー番号」。DocumentViewer から postMessage で連携し、左ペインでハイライト。 | RUNBOOK 3.10 / templates/index.html |
| データ配布方針 | USB 同期を維持しつつ、API によるハイブリッド構成を将来的に導入。ネットワーク障害時はローカルキャッシュを使用。 | RUNBOOK 3.8 |
| API トークン運用 | ステーション単位で API トークンを発行。`/etc/toolmgmt/api_token.json` に保存し、監査ログへ station_id を残す。 | RUNBOOK 3.4 |

## 4. 完了済み主要項目

- ZIP 版からの復旧ベースライン構築（Flask + Socket.IO、Docker/Postgres、systemd 連携）。
- USB マスターデータ同期と DocumentViewer importer の連携。 
- API トークン認証・監査ログ、セキュリティ対策（UFW、SSH 鍵化、fail2ban 等）。
- DocumentViewer 右ペイン UI、工程設定 UI の最新化。 
- OnSiteLogistics（ハンディリーダ）から `POST /api/v1/scans` を受け付け、`part_locations` upsert と `Socket.IO` ブロードキャストを実装。`feature/scan-intake` ブランチで稼働し、RUNBOOK 3.4 に連携手順を整備。
- Window A から RaspberryPiServer の `/api/v1/production-plan`, `/api/v1/standard-times`, `/api/v1/part-locations`, `/api/v1/station-config` を利用するクライアント統合を完了。REST エラー時の表示と単体テストを整備。

## 5. 運用上のメモ

- セキュリティ関連の詳細は `docs/security-overview.md` と `docs/security-requirements-response.md` を参照。
- DocumentViewer 右ペインの詳細な作業計画は `docs/right-pane-plan.md` に記載。
- ドキュメントを更新する際は `docs/documentation-guidelines.md` に従い、情報の所在が重複しないように整理する。
- エージェント・自動化作業の基本指示は `docs/AGENTS.md` を参照。

## 6. 現在の進捗メモ（2025-10-27 時点）
- Window A クライアントは RaspberryPiServer の REST API と Socket.IO へ接続済み。API 障害時は UI に警告を表示し、復旧後に再取得する。
- OnSiteLogistics からの `POST /api/v1/scans` はサーバー側で処理し、Window A は所在一覧を REST で参照する構成へ移行。今後は USB 取り込み→サーバー更新→クライアント自動反映の一連フローを整備する。
- 次フェーズの優先タスク:
  - RaspberryPiServer 側の ingest スクリプトを刷新し、CSV 取り込み時に `/api/v1/production-plan` 等へ即時反映させる。
  - REST 成功／失敗ログを RUNBOOK に追記し、14 日検証手順へ組み込む。
  - 工程設定 UI の文言調整と `RASPI_SERVER_API_TOKEN` 運用ルールを API トークン管理フローへ統合する。
