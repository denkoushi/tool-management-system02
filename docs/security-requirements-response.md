# 情シス要求へのセキュリティ対応状況

この資料は、情シス担当部署から提示されたチェックリストに対し、現行実装がどのように対応しているかを説明するものです。各項目について、既存ドキュメントと運用手順を参照できるようにしています。

## 1. ネットワークセキュリティ（UFW）

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| `sudo apt install ufw` | UFW を導入済み。`scripts/configure_ufw.sh` で初期設定を自動化。 | `sudo ufw status numbered` で許可ルールを確認。 | RUNBOOK 3.3 |
| デフォルト拒否 + 必要ポートのみ許可 | `ufw default deny` + `ufw allow 22/tcp` を適用。さらに `configure_ufw.sh <CIDR>` で許可 IP を限定。 | 例：`sudo ./scripts/configure_ufw.sh 192.168.128.111 --no-enable` → 現場で `sudo ufw enable`。 | RUNBOOK 3.3 |
| 特定 IP のみアクセス許可 | SSH/VNC それぞれ許可 IP を登録済み。VNC は Mac の IP のみ許可。 | `sudo ufw status numbered` で `22/tcp` と `5900/tcp` の許可先を確認。 | RUNBOOK 6.4 |

## 2. アクセス制御

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| 管理画面/API の認証 | `API_AUTH_TOKEN` により全管理 API をトークン必須化。UI も初回操作時にパスコード入力。 | `curl -X POST /api/reset` をトークン無し/有りで叩き、401/200 を確認。 | RUNBOOK 3.4 |
| SSH 公開鍵認証化 | `/etc/ssh/sshd_config` で `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers tools01` を設定。 | `sudo sshd -t` で構文確認。別セッションで鍵ログインできることを確認。 | RUNBOOK 3.3 |
| fail2ban 導入 | `fail2ban` を systemd ジャーナル監視モードで稼働。`sshd` jail を有効化。 | `sudo fail2ban-client status sshd` で `Status : active` を確認。 | RUNBOOK 3.3 |

## 3. 不要サービスの無効化

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| 不要サービス停止 | Bluetooth を停止 (`systemctl disable bluetooth`)。VNC は運用上必要なため稼働、ただし UFW でアクセス元を限定。 | `systemctl status bluetooth` / `systemctl status vncserver-x11-serviced`。 | RUNBOOK 6.4 |
| 不要ポート閉鎖 | UFW によりデフォルト拒否。許可ポートは 22/tcp と申請済み IP への 5900/tcp のみ。 | `sudo ufw status numbered`。 | RUNBOOK 3.3 |
| fail2ban 再掲 | SSH ブルートフォース対策として導入済み。 |  | RUNBOOK 3.3 |

## 4. OS とソフトウェア更新

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| オンライン更新手順 | 現場が一時的に外部ネットワークに出られる場合、`sudo apt update && sudo apt upgrade` を実施。 | 更新前にフルバックアップを取得。 | RUNBOOK 4.1 |
| オフライン更新手順 | 社内 LAN などで `apt-get download <pkg>` → USB 経由で持ち込み `sudo dpkg -i`。 | ダウンロード元端末に記録を残す。 | RUNBOOK 4.1 |
| バックアップ体制 | `backup_db.timer` により日次で DB バックアップ、`check_backup_status.sh` で週次点検。 | `./scripts/check_backup_status.sh` の結果を運用ノートへ記録。 | RUNBOOK 4.1-4.3 |

## 5. ClamAV

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| ClamAV インストール | `sudo apt install clamav` 済み。USB 同期時に `clamscan` を自動実行。 | USB 同期で不正ファイルを検知した場合、守備ログ `/var/log/toolmgmt/usbsync.log` に WARN が記録される。 | RUNBOOK 3.1 |
| 手動スキャン例 | `sudo clamscan -r /path/to/directory` が利用可能。 | 定義更新はオフライン手順に従い USB で配布。 | RUNBOOK 3.2 |

## 6. 物理的セキュリティ

| 要求 | 実施状況 | 運用・確認 | 参照 |
| --- | --- | --- | --- |
| ラズパイ筐体の施錠 | 専用ケースに格納し、鍵で管理する運用を推奨。 | 定期棚卸しでケース破損・鍵管理状況をチェック。 | security-overview 3 (運用ポリシー) |

---

## 補足

- 上記以外の詳細な手順・運用フローは RUNBOOK と security-overview に統合してあります。
- 追加要望があれば、関連スクリプト (`scripts/`) と連動させる形で随時拡張可能です。
