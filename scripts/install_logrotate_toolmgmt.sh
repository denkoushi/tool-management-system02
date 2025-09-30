#!/bin/bash
set -euo pipefail

CONFIG_PATH="/etc/logrotate.d/toolmgmt"

read -r -d '' CONFIG <<'CFG'
/var/log/toolmgmt/usbsync.log /var/log/toolmgmt/api_actions.log /var/log/document-viewer/import.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 tools01 tools01
    sharedscripts
}
CFG

echo "Installing logrotate configuration to ${CONFIG_PATH}"
echo "${CONFIG}" | sudo tee "${CONFIG_PATH}" >/dev/null
sudo chmod 644 "${CONFIG_PATH}"

echo "Running logrotate lint" 
sudo logrotate --debug "${CONFIG_PATH}" | sed -n '1,20p'

echo "Done."
