#!/usr/bin/env bash
# shellcheck disable=SC2086
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)

DEFAULT_SAMPLE="${REPO_ROOT}/config/window-a-client.env.sample"
DEFAULT_TARGET="/etc/toolmgmt/window-a-client.env"
TARGET_FILE="${1:-${DEFAULT_TARGET}}"
SAMPLE_FILE="${2:-${DEFAULT_SAMPLE}}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "This script must be run as root (use sudo)." >&2
  exit 1
fi

if [[ ! -f "${SAMPLE_FILE}" ]]; then
  echo "Sample file not found: ${SAMPLE_FILE}" >&2
  exit 1
fi

install_dir=$(dirname "${TARGET_FILE}")
install -d -o tools01 -g tools01 -m 750 "${install_dir}"

if [[ -f "${TARGET_FILE}" ]]; then
  timestamp=$(date +"%Y%m%d%H%M%S")
  backup="${TARGET_FILE}.${timestamp}.bak"
  echo "Backing up existing file to ${backup}"
  install -o root -g root -m 640 "${TARGET_FILE}" "${backup}"
fi

echo "Installing ${SAMPLE_FILE} -> ${TARGET_FILE}"
install -o tools01 -g tools01 -m 640 "${SAMPLE_FILE}" "${TARGET_FILE}"

cat <<'INFO'
Environment file installed.

Next steps:
  1. Edit the file to match your environment:
       sudoedit /etc/toolmgmt/window-a-client.env
  2. Load it via systemd drop-in if not yet configured:
       sudo systemctl edit toolmgmt.service
       [Service]
       EnvironmentFile=-/etc/toolmgmt/window-a-client.env
  3. Reload and restart the service:
       sudo systemctl daemon-reload
       sudo systemctl restart toolmgmt.service

INFO
