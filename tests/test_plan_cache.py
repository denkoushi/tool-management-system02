import importlib
import os
from pathlib import Path


def test_maybe_refresh_plan_cache(tmp_path, monkeypatch):
    repo_root = Path(__file__).resolve().parents[1]
    sample_dir = repo_root / "docs" / "sample-data"

    monkeypatch.setenv("PLAN_REMOTE_BASE_URL", f"file://{sample_dir}")
    monkeypatch.setenv("PLAN_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PLAN_REMOTE_REFRESH_SECONDS", "1")

    if "plan_cache" in os.sys.modules:
        importlib.reload(os.sys.modules["plan_cache"])
    else:
        import plan_cache  # noqa: F401

    plan_cache = importlib.import_module("plan_cache")
    plan_cache.maybe_refresh_plan_cache(lambda msg: None)

    assert (tmp_path / "production_plan.csv").exists()
    assert (tmp_path / "standard_times.csv").exists()
