#!/usr/bin/env bash
# shellcheck disable=SC2086
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)

DEFAULT_SAMPLE="${REPO_ROOT}/config/window-a-client.env.sample"
DEFAULT_TARGET="/etc/toolmgmt/window-a-client.env"
DEFAULT_DROPIN_SAMPLE="${REPO_ROOT}/config/systemd/toolmgmt.service.d/window-a.conf.sample"

TARGET_FILE="${DEFAULT_TARGET}"
SAMPLE_FILE="${DEFAULT_SAMPLE}"
DROPIN_TARGET=""
DROPIN_SAMPLE="${DEFAULT_DROPIN_SAMPLE}"

usage() {
  cat <<EOF
Usage: sudo ./scripts/install_window_a_env.sh [options]

Options:
  --target PATH           Destination for environment file (default: ${DEFAULT_TARGET})
  --sample PATH           Source sample env file (default: ${DEFAULT_SAMPLE})
  --with-dropin           Install systemd drop-in using default target
  --dropin-target PATH    Install drop-in to PATH (implies --with-dropin)
  --dropin-sample PATH    Use custom drop-in sample file
  --help                  Show this help
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -lt 2 ]] && usage
      TARGET_FILE="$2"
      shift 2
      ;;
    --sample)
      [[ $# -lt 2 ]] && usage
      SAMPLE_FILE="$2"
      shift 2
      ;;
    --with-dropin)
      DROPIN_TARGET="${DROPIN_TARGET:-/etc/systemd/system/toolmgmt.service.d/window-a.conf}"
      shift
      ;;
    --dropin-target)
      [[ $# -lt 2 ]] && usage
      DROPIN_TARGET="$2"
      shift 2
      ;;
    --dropin-sample)
      [[ $# -lt 2 ]] && usage
      DROPIN_SAMPLE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

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

INFO

if [[ -n "${DROPIN_TARGET}" ]]; then
  dropin_dir=$(dirname "${DROPIN_TARGET}")
  install -d -o root -g root -m 755 "${dropin_dir}"
  if [[ -f "${DROPIN_TARGET}" ]]; then
    timestamp=$(date +"%Y%m%d%H%M%S")
    backup="${DROPIN_TARGET}.${timestamp}.bak"
    echo "Backing up existing drop-in to ${backup}"
    install -o root -g root -m 644 "${DROPIN_TARGET}" "${backup}"
  fi
  echo "Installing drop-in ${DROPIN_SAMPLE} -> ${DROPIN_TARGET}"
  install -o root -g root -m 644 "${DROPIN_SAMPLE}" "${DROPIN_TARGET}"
fi

cat <<'NEXT'
Next steps:
  1. 編集:   sudoedit /etc/toolmgmt/window-a-client.env
  2. 反映:   sudo systemctl daemon-reload
             sudo systemctl restart toolmgmt.service
  3. 確認:   sudo systemctl --no-pager status toolmgmt.service

NEXT
