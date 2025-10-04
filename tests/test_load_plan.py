from pathlib import Path

import importlib
import pytest


def test_load_plan_dataset(tmp_path, monkeypatch):
    pytest.importorskip("flask")
    repo_root = Path(__file__).resolve().parents[1]
    sample_dir = repo_root / "docs" / "sample-data"
    tmp_plan_dir = tmp_path / "plan"
    tmp_plan_dir.mkdir()

    for file_name in ("production_plan.csv", "standard_times.csv"):
        data = (sample_dir / file_name).read_text(encoding="utf-8")
        (tmp_plan_dir / file_name).write_text(data, encoding="utf-8")

    monkeypatch.setenv("PLAN_DATA_DIR", str(tmp_plan_dir))

    if "app_flask" in importlib.sys.modules:
        importlib.reload(importlib.sys.modules["app_flask"])
    else:
        import app_flask  # noqa: F401

    app_flask = importlib.import_module("app_flask")
    data = app_flask.build_production_view()

    assert data["entries"], "生産計画のエントリが読み込めていません"
    assert data["standard_entries"], "標準工数のエントリが読み込めていません"
