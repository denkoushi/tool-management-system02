"""Station configuration utilities for process selection."""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from raspi_client import (
    RaspiServerAuthError,
    RaspiServerClient,
    RaspiServerClientError,
)


def _is_writable(path: Path) -> bool:
    """Return True if station config file (or its parent directory) is writable."""
    try:
        if path.exists():
            return os.access(path, os.W_OK)
        return os.access(path.parent, os.W_OK)
    except Exception:
        return False

STATION_CONFIG_PATH = Path(os.getenv("STATION_CONFIG_PATH", "/var/lib/toolmgmt/station.json"))
try:
    STATION_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
except PermissionError:
    # 読み取り専用環境では作成できない場合がある
    pass


def _create_client() -> RaspiServerClient:
    return RaspiServerClient.from_env()


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _default_config() -> Dict[str, object]:
    env_process = os.getenv("STATION_PROCESS", "").strip()
    base = {
        "process": env_process,
        "available": [],
        "updated_at": None,
        "source": "env" if env_process else "default",
        "error": None,
        "path": str(STATION_CONFIG_PATH),
        "writable": _is_writable(STATION_CONFIG_PATH),
    }
    if env_process:
        base["available"] = [env_process]
    return base


def _sanitize_available(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    cleaned: List[str] = []
    for item in values:
        if not isinstance(item, str):
            continue
        name = item.strip()
        if name and name not in cleaned:
            cleaned.append(name)
    return cleaned


def _merge_error(existing: Optional[str], message: Optional[str]) -> Optional[str]:
    parts = [msg for msg in (message, existing) if msg]
    if not parts:
        return None
    merged: List[str] = []
    for msg in parts:
        if msg not in merged:
            merged.append(msg)
    return " / ".join(merged)


def load_station_config() -> Dict[str, object]:
    client = _create_client()
    if client.is_configured():
        try:
            payload = client.get_json("/api/v1/station-config")
            process = str(payload.get("process", "") or "").strip()
            available = _sanitize_available(payload.get("available"))
            if process and process not in available:
                available.append(process)
            return {
                "process": process,
                "available": available,
                "updated_at": payload.get("updated_at"),
                "source": "raspi_server",
                "error": None,
                "path": f"{client.base_url}/api/v1/station-config",
                "writable": True,
            }
        except (RaspiServerAuthError, RaspiServerClientError) as exc:
            error = f"RaspberryPiServer: {exc}"
            local = _load_local_station_config()
            local["error"] = _merge_error(local.get("error"), error)
            return local

    return _load_local_station_config()


def _load_local_station_config() -> Dict[str, object]:
    """Load station configuration with local file fallback."""
    config = _default_config()
    path = STATION_CONFIG_PATH

    if not path.exists():
        config["writable"] = _is_writable(path)
        return config

    try:
        with path.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception as exc:  # broad catch to surface error
        config["error"] = f"station.json を読み込めませんでした: {exc}"
        config["source"] = "error"
        config["writable"] = _is_writable(path)
        return config

    process = str(data.get("process", "")).strip()
    available = _sanitize_available(data.get("available"))
    if process and process not in available:
        available.append(process)

    updated_at = data.get("updated_at")
    if not isinstance(updated_at, str):
        updated_at = None

    config.update(
        {
            "process": process,
            "available": available,
            "updated_at": updated_at,
            "source": "file",
            "error": None,
        }
    )
    config["writable"] = _is_writable(path)
    return config


def save_station_config(process: Optional[str] = None, available: Optional[List[str]] = None) -> Dict[str, object]:
    client = _create_client()
    current = load_station_config()
    sanitized_process = current.get("process", "")
    if process is not None:
        sanitized_process = process.strip()
    sanitized_available = current.get("available", [])
    if available is not None:
        sanitized_available = _sanitize_available(available)
    if sanitized_process:
        if sanitized_process not in sanitized_available:
            sanitized_available.append(sanitized_process)
    else:
        sanitized_available = _sanitize_available(sanitized_available)

    if client.is_configured():
        try:
            payload = {
                "process": sanitized_process,
                "available": sanitized_available,
            }
            saved = client.post_json("/api/v1/station-config", payload)
            process_value = str(saved.get("process", "") or "").strip()
            response_available = _sanitize_available(saved.get("available"))
            if process_value and process_value not in response_available:
                response_available.append(process_value)
            return {
                "process": process_value,
                "available": response_available,
                "updated_at": saved.get("updated_at"),
                "source": "raspi_server",
                "error": None,
                "path": f"{client.base_url}/api/v1/station-config",
                "writable": True,
            }
        except (RaspiServerAuthError, RaspiServerClientError) as exc:
            error = f"RaspberryPiServer: {exc}"
            if not _is_writable(STATION_CONFIG_PATH):
                raise RaspiServerClientError(error) from exc
            local_saved = _save_local_station_config(sanitized_process, sanitized_available)
            local_saved["error"] = _merge_error(local_saved.get("error"), error)
            return local_saved

    return _save_local_station_config(sanitized_process, sanitized_available)


def _save_local_station_config(process: str, available: List[str]) -> Dict[str, object]:
    """Persist station configuration to local file."""
    if not _is_writable(STATION_CONFIG_PATH):
        raise PermissionError(f"station.json に書き込みできません: {STATION_CONFIG_PATH}")

    payload: Dict[str, object] = {
        "process": process,
        "available": available,
        "updated_at": _now_iso(),
    }

    with STATION_CONFIG_PATH.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    payload_with_meta = dict(payload)
    payload_with_meta.update({
        "source": "file",
        "error": None,
        "path": str(STATION_CONFIG_PATH),
        "writable": True,
    })
    return payload_with_meta


def ensure_process(process: str) -> None:
    """Ensure the given process exists in configuration without altering selection."""
    config = load_station_config()
    available = config.get("available", [])
    if process not in available:
        available.append(process)
        save_station_config(config.get("process", ""), available)
