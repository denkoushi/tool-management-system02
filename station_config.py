"""Station configuration utilities for process selection."""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

STATION_CONFIG_PATH = Path(os.getenv("STATION_CONFIG_PATH", "/var/lib/toolmgmt/station.json"))
try:
    STATION_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
except PermissionError:
    # 読み取り専用環境では作成できない場合がある
    pass


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


def load_station_config() -> Dict[str, object]:
    """Load station configuration with fallbacks."""
    config = _default_config()
    path = STATION_CONFIG_PATH

    if not path.exists():
        return config

    try:
        with path.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception as exc:  # broad catch to surface error
        config["error"] = f"station.json を読み込めませんでした: {exc}"
        config["source"] = "error"
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
    return config


def save_station_config(process: Optional[str] = None, available: Optional[List[str]] = None) -> Dict[str, object]:
    """Persist station configuration and return the updated structure."""
    current = load_station_config()
    if current.get("source") == "error":
        current = _default_config()

    new_process = current.get("process", "")
    if process is not None:
        new_process = process.strip()

    new_available = current.get("available", [])
    if available is not None:
        new_available = _sanitize_available(available)
    if new_process:
        if new_process not in new_available:
            new_available.append(new_process)
    else:
        new_available = _sanitize_available(new_available)

    payload: Dict[str, object] = {
        "process": new_process,
        "available": new_available,
        "updated_at": _now_iso(),
    }

    with STATION_CONFIG_PATH.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    payload_with_meta = dict(payload)
    payload_with_meta.update({
        "source": "file",
        "error": None,
        "path": str(STATION_CONFIG_PATH),
    })
    return payload_with_meta


def ensure_process(process: str) -> None:
    """Ensure the given process exists in configuration without altering selection."""
    config = load_station_config()
    available = config.get("available", [])
    if process not in available:
        available.append(process)
        save_station_config(config.get("process", ""), available)
