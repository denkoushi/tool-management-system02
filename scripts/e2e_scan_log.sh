#!/usr/bin/env bash
# Wrapper around check_e2e_scan.sh that appends timestamped results to a log file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/check_e2e_scan.sh"

LOG_DIR="${LOG_DIR:-/var/log/toolmgmt}"
LOG_FILE="${LOG_FILE:-${LOG_DIR}/e2e.log}"

mkdir -p "${LOG_DIR}"

timestamp="$(date '+%Y-%m-%dT%H:%M:%S%z')"
{
  printf '=== %s ===\n' "${timestamp}"
  if "${CHECK_SCRIPT}"; then
    printf '[OK] check_e2e_scan.sh completed successfully\n'
  else
    status=$?
    printf '[NG] check_e2e_scan.sh exited with status %s\n' "${status}"
    exit "${status}"
  fi
} >> "${LOG_FILE}" 2>&1
