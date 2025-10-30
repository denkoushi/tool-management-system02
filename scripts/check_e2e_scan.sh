#!/usr/bin/env bash

# Quick end-to-end sanity check for Window A (Pi4).
# 1. ping raspi-server.local via mDNS
# 2. POST /api/v1/scans and report HTTP status

set -euo pipefail

SERVER_HOST=${SERVER_HOST:-raspi-server.local}
SERVER_PORT=${SERVER_PORT:-8501}
TOKEN=${API_TOKEN:-raspi-token-20251027}
PART_CODE=${PART_CODE:-testpart}
LOCATION_CODE=${LOCATION_CODE:-RACK-A1}
DEVICE_ID=${DEVICE_ID:-window-a-test}

info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
error() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*"; }

info "1) Checking reachability to ${SERVER_HOST}"
if ping -c 2 "${SERVER_HOST}" >/dev/null 2>&1; then
  info "   ping OK"
else
  error "   ping failed. Check Avahi / hostnamectl on Pi5."
  exit 2
fi

info "2) POST /api/v1/scans"
payload=$(cat <<JSON
{
  "part_code": "${PART_CODE}",
  "location_code": "${LOCATION_CODE}",
  "device_id": "${DEVICE_ID}"
}
JSON
)

response=$(curl -sS -w '\nHTTP %{http_code}\n' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${payload}" \
  "http://${SERVER_HOST}:${SERVER_PORT}/api/v1/scans") || {
    error "   curl failed"
    exit 3
  }

body=$(printf '%s' "${response}" | sed '$d')
status=$(printf '%s' "${response}" | tail -n1 | awk '{print $2}')

printf '%s\n' "${body}" | jq '.' >/dev/null 2>&1 || warn "   jq not installed。生レスポンス: ${body}"

if [[ "${status}" == "201" ]]; then
  info "   HTTP 201 (accepted)"
else
  warn "   Unexpected HTTP status: ${status}"
fi

info "3) For Socket.IO / Viewer 確認, follow docs/checklists/daily-end-to-end.md"
