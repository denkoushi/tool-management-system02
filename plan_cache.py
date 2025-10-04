"""Remote plan data caching helper.

Optional fetch of production plan / standard time CSV from remote endpoint.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

PLAN_DATA_DIR = Path(os.getenv("PLAN_DATA_DIR", "/var/lib/toolmgmt/plan"))
REMOTE_BASE = os.getenv("PLAN_REMOTE_BASE_URL", "").rstrip("/")
REMOTE_TOKEN = os.getenv("PLAN_REMOTE_TOKEN", "")
REMOTE_TIMEOUT = float(os.getenv("PLAN_REMOTE_TIMEOUT", "5"))
REFRESH_INTERVAL = int(os.getenv("PLAN_REMOTE_REFRESH_SECONDS", "600"))
META_FILE = PLAN_DATA_DIR / "remote_meta.json"

DATASETS = {
    "production_plan": "production_plan.csv",
    "standard_times": "standard_times.csv",
}


@dataclass
class RefreshMeta:
    fetched_at: float
    dataset_meta: Dict[str, float]

    @classmethod
    def load(cls) -> "RefreshMeta":
        if META_FILE.exists():
            try:
                data = json.loads(META_FILE.read_text(encoding="utf-8"))
                return cls(
                    fetched_at=float(data.get("fetched_at", 0)),
                    dataset_meta={k: float(v) for k, v in data.get("dataset_meta", {}).items()},
                )
            except Exception:
                pass
        return cls(fetched_at=0.0, dataset_meta={})

    def save(self) -> None:
        META_FILE.parent.mkdir(parents=True, exist_ok=True)
        META_FILE.write_text(
            json.dumps({
                "fetched_at": self.fetched_at,
                "dataset_meta": self.dataset_meta,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class PlanFetchError(Exception):
    pass


def _should_refresh(meta: RefreshMeta) -> bool:
    if not REMOTE_BASE:
        return False
    # always refresh if never fetched
    now = time.time()
    if meta.fetched_at <= 0:
        return True
    return (now - meta.fetched_at) >= REFRESH_INTERVAL


def _download_dataset(filename: str) -> bytes:
    if REMOTE_BASE.startswith("file://"):
        local_path = Path(REMOTE_BASE[7:]) / filename
        return local_path.read_bytes()

    url = f"{REMOTE_BASE}/{filename}"
    req = urllib.request.Request(url, method="GET")
    if REMOTE_TOKEN:
        req.add_header("Authorization", f"Bearer {REMOTE_TOKEN}")
    with urllib.request.urlopen(req, timeout=REMOTE_TIMEOUT) as response:
        if response.status >= 400:
            raise PlanFetchError(f"{filename}: HTTP {response.status}")
        return response.read()


def maybe_refresh_plan_cache(logger=print) -> None:
    meta = RefreshMeta.load()
    if not _should_refresh(meta):
        return

    if not REMOTE_BASE:
        return

    logger("[plan-cache] remote refresh start")

    try:
        for key, filename in DATASETS.items():
            try:
                data = _download_dataset(filename)
            except FileNotFoundError:
                logger(f"[plan-cache] {filename} not found in remote source")
                continue
            except Exception as exc:  # pylint: disable=broad-except
                logger(f"[plan-cache] failed to fetch {filename}: {exc}")
                raise

            target_path = PLAN_DATA_DIR / filename
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(data)
            meta.dataset_meta[key] = time.time()
            logger(f"[plan-cache] updated {filename} ({len(data)} bytes)")

        meta.fetched_at = time.time()
        meta.save()
        logger("[plan-cache] remote refresh finished")
    except Exception as exc:  # pylint: disable=broad-except
        logger(f"[plan-cache] refresh aborted: {exc}")

