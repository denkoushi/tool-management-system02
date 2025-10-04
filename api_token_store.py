"""API token storage and retrieval utilities."""
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Dict

API_TOKEN_FILE = Path(os.getenv("API_TOKEN_FILE", "/etc/toolmgmt/api_token.json"))
API_TOKEN_HEADER = os.getenv("API_TOKEN_HEADER", "X-API-Token")
_server_station_id = os.getenv("STATION_ID", "")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _ensure_parent_exists() -> None:
    try:
        API_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        pass


def load_token_file() -> Dict[str, str]:
    if not API_TOKEN_FILE.exists():
        token = os.getenv("API_AUTH_TOKEN", "").strip()
        if token:
            return {
                "token": token,
                "station_id": _server_station_id,
                "issued_at": None,
                "source": "env",
            }
        return {"token": "", "station_id": "", "issued_at": None, "source": "none"}

    try:
        with API_TOKEN_FILE.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
            return {
                "token": str(data.get("token", "")),
                "station_id": str(data.get("station_id", "")),
                "issued_at": data.get("issued_at"),
                "note": data.get("note"),
                "source": "file",
            }
    except Exception as exc:
        return {"token": "", "station_id": "", "issued_at": None, "error": str(exc), "source": "error"}


def save_token_file(station_id: str, token: str, note: str | None = None) -> Dict[str, str]:
    _ensure_parent_exists()
    payload = {
        "token": token,
        "station_id": station_id,
        "issued_at": _now_iso(),
    }
    if note:
        payload["note"] = note
    with API_TOKEN_FILE.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    payload["source"] = "file"
    return payload


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def delete_token_file() -> None:
    if API_TOKEN_FILE.exists():
        API_TOKEN_FILE.unlink()


def get_token_info() -> Dict[str, str]:
    info = load_token_file()
    if info.get("station_id") and not info.get("token"):
        # station_id only, mark as invalid
        info["error"] = info.get("error") or "token missing"
    return info
