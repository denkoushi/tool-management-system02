# 要件とロードマップ

この文書は tool-management-system02 プロジェクトの機能要件、優先順位、未対応タスク、および決定事項を一元管理します。運用手順（RUNBOOK）や個別計画（right-pane-plan）と併用し、情報が分散しないようにしてください。

## 1. 現状の優先度

1. **工程設定 UX / 保守性強化**  
   - station.json の CRUD を UI/API で完結させる。  
   - DocumentViewer への即時反映、設定エラー時の復旧手順簡素化。
2. **API トークン運用の高度化**  
   - 複数トークン管理、履歴保持、UI からの再発行を検討。  
   - 初期セットアップ手順への統合、監査ログの整備。
3. **データ配布（USB + リモート）の両立**  
   - USB 運用を維持しつつリモート API を設計。  
   - 認証、フォールバック、UI メッセージの整理。
4. **テスト戦略の拡張**  
   - pytest / シェルスモークで USB・工程設定などの最小検証を自動化。  
   - CI 導入に向けた準備。
5. **ドキュメント整備の継続**  
   - 初期構築ガイドやトラブルシュートを最新化。  
   - Decision Log を本書に集約しリンク構造を保つ。

## 2. バックログ

### 2.1 工程設定関連
- 設定編集 API・管理 UI の追加（工程リスト CRUD、初期化機能の整備）。
- station.json 欠損・破損時の自動復旧、UI 上でのエラーメッセージ改善。

### 2.2 データ配布・計画連携
- 生産計画 API エンドポイントの設計、キャッシュ更新ロジック、失敗時のフォールバックメッセージ。 
- 認証・監査設計（API トークンまたは別トークン）。
- USB とリモート配布の併用フェーズにおける運用手順更新。

### 2.3 API トークン運用
- トークン管理スクリプトの高度化（複数トークン対応、履歴管理）。
- 初期セットアップ手順への統合、GUI 連携の検討。

### 2.4 ドキュメント／サポート
- 初期構築ガイドの詳細化（CLI コマンド、設定ファイル例、障害対応）。
- Decision ログの要約版と相互参照の維持。 
- スクリーンショット・図版の追加（UI 安定後）。

### 2.5 テスト／CI
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

## 5. 運用上のメモ

- セキュリティ関連の詳細は `docs/security-overview.md` と `docs/security-requirements-response.md` を参照。
- DocumentViewer 右ペインの詳細な作業計画は `docs/right-pane-plan.md` に記載。
- ドキュメントを更新する際は `docs/documentation-guidelines.md` に従い、情報の所在が重複しないように整理する。
