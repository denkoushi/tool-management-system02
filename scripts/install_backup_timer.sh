#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

# service
sudo tee /etc/systemd/system/backup_db.service >/dev/null <<EOF
[Unit]
Description=Daily pg_dump for toolmgmt (via docker)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
User=${USER_NAME}
WorkingDirectory=${PROJECT_DIR}
Environment=PATH=${PROJECT_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/bin/bash -lc '${PROJECT_DIR}/scripts/backup_db.sh'
EOF

# timer (毎日 02:30 JST)
sudo tee /etc/systemd/system/backup_db.timer >/dev/null <<EOF
[Unit]
Description=Run backup_db.service daily at 02:30 JST

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=backup_db.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now backup_db.timer
systemctl list-timers --all | grep backup_db || true
