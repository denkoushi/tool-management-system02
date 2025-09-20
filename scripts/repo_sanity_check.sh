#!/bin/bash
# repo_sanity_check.sh : リポジトリ整合の簡易点検
set -euo pipefail
cd "$(dirname "$0")/.."

ok(){ printf "  [OK] %s\n" "$1"; }
ng(){ printf "  [NG] %s\n" "$1"; exitcode=1; }

exitcode=0

echo "== Files"
for f in .gitignore README.md RUNBOOK.md CHANGELOG.md app_flask.py docker-compose.yml requirements.txt setup_auto_start.sh \
         templates/index.html static/js/socket.io.js \
         scripts/backup_db.sh scripts/install_backup_timer.sh \
         scripts/os_prereqs.sh scripts/install_docker.sh \
         scripts/install_kiosk_autostart.sh scripts/remove_kiosk_autostart.sh \
         scripts/apply_db_tuning.sql scripts/apply_db_tuning.sh
do
  [ -e "$f" ] && ok "$f" || ng "missing: $f"
done

echo "== Content checks"
grep -q 'connect retry' app_flask.py && ok "DBリトライ ログ文あり" || ng "DBリトライ不在?"
grep -q '@app.route("/api/shutdown"' app_flask.py && ok "/api/shutdown あり" || ng "/api/shutdown 不在?"
grep -q 'btnShutdownFixed' templates/index.html && ok "shutdownボタンJSブロックあり" || ng "shutdownボタンJS不在?"

echo "== docker-compose.yml"
grep -q 'restart: unless-stopped' docker-compose.yml && ok "restart policy" || ng "restart policy 不足?"
grep -q 'healthcheck:' docker-compose.yml && ok "healthcheck" || ng "healthcheck 不足?"
grep -q '127.0.0.1:5432' docker-compose.yml && ok "PG: localhost bind" || ng "PG: bind未設定?"
grep -q '127.0.0.1:3000' docker-compose.yml && ok "Grafana: localhost bind" || ng "Grafana: bind未設定?"

echo "== Done."
exit $exitcode
