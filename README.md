# tool-management-system02(Raspberry Pi 5 / ZIP Restore Baseline)

このリポジトリは、Raspberry Pi 5 上で動作していた **ZIP 版の安定構成**をそのまま保存する復旧用ベースラインです。  
当面の起動は **`python app_flask.py`** を前提とします。

## 1) 依存関係
```bash
sudo apt update
sudo apt install -y pcscd libpcsclite1 libpcsclite-dev
python3 -m venv venv
source venv/bin/activate
pip install -U pip
pip install -r requirements.txt
