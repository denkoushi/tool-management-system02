# 右側ドキュメントビューア統合プラン

## 1. 現状整理
- **Tool Management System (TMS)**: 既存リポジトリ。本番環境では `toolmgmt.service` が Flask + Socket.IO を `http://127.0.0.1:8501` で提供し、左半分 UI のみ使用中。
- **DocumentViewer (DV)**: 別リポジトリ `denkoushi/DocumentViewer`。Flask アプリ `viewer.py` が `http://0.0.0.0:5000` で PDF ビューアを提供し、`/health`, `/api/documents/<part>` を備える。
- **運用スタイル**: 2 つのサービスは同一ラズパイ上で併存させたい。Git / デプロイ手順はそれぞれ個別に管理する方針。

## 2. 右側エリアの表示方針（ベストプラクティス）
- **iframe 埋め込みを基本**: TMS の右半分 (`.future-panel`) を DV の iframe で常時占有させ、ユーザー体験を「1 画面で 2 システムが並列動作する」構成にする。
- **タブ切替で複合表示**: 右ペインは「要領書」タブを既定表示とし、所在情報タブ（`part_locations`）へ切り替えてハンディリーダ連携結果を Socket.IO でリアルタイムに確認できるよう統合する。
- **URL/ポート管理**: 既定値は `http://127.0.0.1:5000` を想定。将来ポート変更に備えて環境変数 (例: `DOCUMENT_VIEWER_URL`) を TMS 側に追加して設定可能にする。
- **フォーカスとイベント分離**: 左側のバーコード入力と右側のキーボードイベントが干渉しないように tabindex / pointer-event の制御、または iframe 内でキーボードフォーカスを明示的に管理。
- **ヘルスチェック表示**: iframe 読み込み失敗時にアラートを表示する簡易監視を TMS に組み込み、DV 停止を即時検知できるようにする。
- **サービスの起動／停止統一**: systemd を利用し、TMS (`toolmgmt.service`) と DV (`docviewer.service` など仮称) を個別ユニットとして管理。キオスク起動手順では「両サービスが稼働中であること」をチェックリスト化。

## 3. 実装タスク一覧
1. **DocumentViewer 側調査**
   - Raspberry Pi 上で DV を常駐させる方法を決める（venv, systemd, 依存パッケージ）。
   - DocumentViewer リポジトリのセットアップ手順（例: README / docs 配下）を確認し、TMS との併用時に競合するパッケージが無いか確認する。
2. **通信エンドポイントの確定**
   - DV を `http://127.0.0.1:5000`（または別ポート）で固定し、TMS の設定ファイルに base URL を記録。
   - もし別マシンで DV を稼働させる場合は、同一ネットワーク内の固定 IP へ切替えられるよう README/RUNBOOK に記載する。
3. **TMS テンプレート改修**（第一段階完了）
   - `templates/index.html` を DocumentViewer 埋め込み用レイアウトに刷新し、状態表示と再読み込みボタンを追加済み。
   - iframe 読み込み状態を UI に反映（ローディング表示／エラー表示切替など）まで完了。
   - 今後、DocumentViewer からのイベント連携や左右レイアウトの最終調整を継続。
4. **TMS API・設定追加**
   - Flask の設定値に DV のベース URL を注入（`app.config` / `.env` / 設定ファイル）。
   - 将来的な API 連携（例えば貸出操作後に DV をリフレッシュ）を想定し、共通ユーティリティを検討。
5. **USB 共有運用の整備**（実施中）
   - `usb_master_sync.sh` と DocumentViewer の importer を直列実行するラッパを追加（UI ボタンから利用できるよう改修）。
   - USB 内のフォルダ構成（`master/`, `docviewer/`）と `meta.json` 運用ルールを明確化。
   - README / RUNBOOK / DocumentViewer docs を更新し、手順と sudoers 設定、ログ確認方法を追記。
6. **システムテスト**
   - 両サービス同時起動の動作検証（起動スクリプト、systemd、キオスク自動起動）。
   - 左右 UI のキーボード操作・スキャン動作が干渉しないことを確認。
   - ネットワーク切断や DV 停止時の復旧手順を RUNBOOK に追加。

## 4. 検討中・将来課題
- **起動シーケンス自動化**: キオスク起動時に DV の `/health` をチェックし、未起動なら自動スタート or 警告を出す。
- **共通ログ／監視**: 両サービスのログを journalctl / systemd でまとめて確認できるようにし、障害時の原因切り分けを簡潔に。
- **右側 UI の高度化**: 例えば TMS の貸出履歴と連動して DV へメタ情報を渡す、もしくは DV からの通知を TMS へ返すなど、双方向連携 API の検討。
- **将来的なスケーリング**: 別ラズパイに DV を配置するケースに備え、CORS 設定や TLS 化、ネットワーク越しの遅延対策を検討。

### 優先度整理（2025-10-05 時点）

全体の優先度とバックログは `docs/requirements.md` を参照してください。右ペイン統合に関わるタスクのみ、ここで補足します。

1. **DocumentViewer 側サービス整備**  
   - Raspberry Pi 上での常駐化（systemd）、依存パッケージ、ヘルスチェック API の整備。
2. **iframe 連携強化**  
   - station.json 更新時の再読込、postMessage 経由の状態連携の安定化。 
3. **USB 共有運用**  
   - `usb_master_sync.sh` と DocumentViewer importer の直列動作確認、ログ整備、エラーメッセージ統一。

---
このプランに沿ってタスクを順次進め、各ステップ完了後にドキュメントへ反映していきます。
