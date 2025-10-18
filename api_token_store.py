"""API token storage utilities supporting multiple entries."""
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Dict, List

API_TOKEN_FILE = Path(os.getenv("API_TOKEN_FILE", "/etc/toolmgmt/api_token.json"))
API_TOKEN_HEADER = os.getenv("API_TOKEN_HEADER", "X-API-Token")
SERVER_STATION_ID = os.getenv("STATION_ID", "")
STORE_VERSION = 1


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _ensure_parent_exists() -> None:
    try:
        API_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        # 読み取り専用環境ではスキップ
        pass


def _mask(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 6:
        return token[0] + "***" + token[-1]
    return token[:3] + "***" + token[-3:]


def _default_store() -> Dict[str, object]:
    return {"version": STORE_VERSION, "tokens": []}


def _convert_legacy(data: Dict[str, object]) -> Dict[str, object]:
    token = str(data.get("token", ""))
    station_id = str(data.get("station_id", ""))
    note = data.get("note")
    entry = {
        "token": token,
        "station_id": station_id,
        "issued_at": data.get("issued_at") or _now_iso(),
        "note": note,
        "revoked_at": None,
    }
    store = _default_store()
    store["tokens"].append(entry)
    store["migrated_from"] = "legacy"
    return store


def _load_store() -> Dict[str, object]:
    if not API_TOKEN_FILE.exists():
        token = os.getenv("API_AUTH_TOKEN", "").strip()
        if token:
            entry = {
                "token": token,
                "station_id": SERVER_STATION_ID,
                "issued_at": None,
                "note": "env",  # env fallback
                "revoked_at": None,
            }
            store = _default_store()
            store["tokens"].append(entry)
            store["source"] = "env"
            return store
        store = _default_store()
        store["source"] = "none"
        return store

    try:
        with API_TOKEN_FILE.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception as exc:  # pylint: disable=broad-except
        store = _default_store()
        store["tokens"] = []
        store["error"] = str(exc)
        store["source"] = "error"
        return store

    if isinstance(data, dict) and "tokens" in data:
        data.setdefault("version", STORE_VERSION)
        data.setdefault("source", "file")
        return data

    # legacy形式を変換
    store = _convert_legacy(data if isinstance(data, dict) else {})
    store["source"] = "file"
    return store


def _save_store(store: Dict[str, object]) -> None:
    _ensure_parent_exists()
    store = dict(store)
    store["version"] = STORE_VERSION
    store.pop("source", None)
    store.pop("error", None)
    with API_TOKEN_FILE.open('w', encoding='utf-8') as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2)


def list_tokens(with_token: bool = False) -> List[Dict[str, object]]:
    store = _load_store()
    tokens = []
    for entry in store.get("tokens", []):
        item = {
            "station_id": entry.get("station_id", ""),
            "issued_at": entry.get("issued_at"),
            "note": entry.get("note"),
            "revoked_at": entry.get("revoked_at"),
        }
        token_value = entry.get("token", "")
        item["token"] = token_value if with_token else _mask(token_value)
        tokens.append(item)
    return tokens


def get_active_tokens() -> List[Dict[str, object]]:
    store = _load_store()
    active = [entry for entry in store.get("tokens", []) if entry.get("revoked_at") is None and entry.get("token")]
    if store.get("source") == "env" and not active:
        # env フォールバック（revokedなし）
        active = store.get("tokens", [])
    return active


def get_token_info() -> Dict[str, object]:
    store = _load_store()
    active = get_active_tokens()
    if active:
        entry = active[-1]
        return {
            "token": entry.get("token", ""),
            "station_id": entry.get("station_id", ""),
            "issued_at": entry.get("issued_at"),
            "note": entry.get("note"),
            "source": store.get("source", "file"),
            "token_preview": _mask(entry.get("token", "")),
        }
    info = {
        "token": "",
        "station_id": "",
        "issued_at": None,
        "note": None,
        "source": store.get("source", "none"),
    }
    if store.get("error"):
        info["error"] = store["error"]
    else:
        info["error"] = "token missing"
    return info


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def issue_token(station_id: str, token: str | None = None, note: str | None = None, keep_existing: bool = False) -> Dict[str, object]:
    store = _load_store()
    new_token = token or generate_token()
    entries = store.get("tokens", [])
    if not keep_existing:
        now = _now_iso()
        for entry in entries:
            if entry.get("revoked_at") is None:
                entry["revoked_at"] = now
    entry = {
        "token": new_token,
        "station_id": station_id,
        "issued_at": _now_iso(),
        "note": note,
        "revoked_at": None,
    }
    entries.append(entry)
    store["tokens"] = entries
    store["source"] = "file"
    _save_store(store)
    return entry


def revoke_token(token: str | None = None, station_id: str | None = None, all_tokens: bool = False) -> int:
    store = _load_store()
    updated = 0
    now = _now_iso()
    entries = store.get("tokens", [])

    for entry in entries:
        if entry.get("revoked_at") is not None:
            continue
        if all_tokens:
            entry["revoked_at"] = now
            updated += 1
        elif token and entry.get("token") == token:
            entry["revoked_at"] = now
            updated += 1
        elif station_id and entry.get("station_id") == station_id:
            entry["revoked_at"] = now
            updated += 1

    if updated:
        store["tokens"] = entries
        store["source"] = "file"
        _save_store(store)
    return updated


def delete_token_file() -> None:
    if API_TOKEN_FILE.exists():
        API_TOKEN_FILE.unlink()

