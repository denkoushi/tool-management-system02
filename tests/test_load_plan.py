from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def _prepare_sample_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo_root = Path(__file__).resolve().parents[1]
    sample_dir = repo_root / "docs" / "sample-data"
    tmp_plan_dir = tmp_path / "plan"
    tmp_plan_dir.mkdir()

    for file_name in ("production_plan.csv", "standard_times.csv"):
        data = (sample_dir / file_name).read_text(encoding="utf-8")
        (tmp_plan_dir / file_name).write_text(data, encoding="utf-8")

    monkeypatch.setenv("PLAN_DATA_DIR", str(tmp_plan_dir))
    return repo_root


def _ensure_socketio_stub():
    try:
        importlib.import_module("flask_socketio")
        return
    except Exception:  # pragma: no cover - fall back to stub
        sys.modules.pop("flask_socketio", None)

    class DummySocketIO:
        def __init__(self, *args, **kwargs):
            pass

        def init_app(self, app, **kwargs):
            return app

        def emit(self, *args, **kwargs):
            return None

    def _emit(*args, **kwargs):
        return None

    sys.modules["flask_socketio"] = SimpleNamespace(SocketIO=DummySocketIO, emit=_emit)


def _ensure_psycopg_stub():
    try:
        importlib.import_module("psycopg2")
        return
    except ModuleNotFoundError:
        pass

    class DummyConnection:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("psycopg2 stub does not provide real connections")

    sys.modules["psycopg2"] = SimpleNamespace(connect=DummyConnection)


def _ensure_smartcard_stub():
    try:
        importlib.import_module("smartcard")
        return
    except ModuleNotFoundError:
        pass

    class DummyCardRequest:
        def __init__(self, *args, **kwargs):
            pass

        def waitforcardevent(self, *args, **kwargs):
            raise RuntimeError("smartcard stub does not integrate with hardware")

    smartcard_module = SimpleNamespace(CardRequest=DummyCardRequest, util=SimpleNamespace(toHexString=lambda data: "".join(data)))
    sys.modules["smartcard"] = smartcard_module
    sys.modules["smartcard.CardRequest"] = SimpleNamespace(CardRequest=DummyCardRequest)
    sys.modules["smartcard.util"] = SimpleNamespace(toHexString=lambda data: "".join(str(x) for x in data))


def _import_app_flask(repo_root: Path):
    sys.path.insert(0, str(repo_root))
    _ensure_socketio_stub()
    _ensure_psycopg_stub()
    _ensure_smartcard_stub()
    if "app_flask" in sys.modules:
        return importlib.reload(sys.modules["app_flask"])
    return importlib.import_module("app_flask")


def test_build_production_view_local(tmp_path, monkeypatch):
    repo_root = _prepare_sample_data(tmp_path, monkeypatch)
    app_flask = _import_app_flask(repo_root)

    production_view = app_flask.build_production_view()

    assert production_view["plan_entries"], "生産計画のエントリが読み込めていません"
    assert production_view["standard_entries"], "標準工数のエントリが読み込めていません"
    assert production_view.get("plan_source") != "raspi_server"


def test_build_production_view_remote_success(tmp_path, monkeypatch):
    repo_root = _prepare_sample_data(tmp_path, monkeypatch)
    app_flask = _import_app_flask(repo_root)

    class StubClient:
        base_url = "http://raspi.local"

        def is_configured(self):
            return True

        def get_plan_dataset(self, key: str):
            if key == "production_plan":
                return {
                    "entries": [
                        {
                            "納期": "2025-01-05",
                            "個数": "20",
                            "部品番号": "PART-001",
                            "部品名": "テスト部品",
                            "製番": "JOB-XYZ",
                            "工程名": "切削",
                        }
                    ],
                    "updated_at": "2025-01-05T00:00:00Z",
                    "error": None,
                }
            return {
                "entries": [
                    {
                        "部品名": "テスト部品",
                        "機械標準工数": "10",
                        "製造オーダー番号": "JOB-XYZ",
                        "部品番号": "PART-001",
                        "工程名": "切削",
                    }
                ],
                "updated_at": "2025-01-05T00:00:00Z",
                "error": None,
            }

        def get_part_locations(self, limit: int):
            return {"entries": []}

    monkeypatch.setattr(app_flask, "_create_raspi_client", lambda: StubClient())

    production_view = app_flask.build_production_view()

    assert production_view["plan_source"] == "raspi_server"
    assert production_view["plan_entries"][0]["納期"] == "2025-01-05"
    assert production_view["standard_entries"][0]["部品番号"] == "PART-001"
    assert production_view["plan_error"] is None


def test_build_production_view_remote_fallback(tmp_path, monkeypatch):
    repo_root = _prepare_sample_data(tmp_path, monkeypatch)
    app_flask = _import_app_flask(repo_root)

    error_message = "network unavailable"

    class FailingClient:
        base_url = "http://raspi.local"

        def is_configured(self):
            return True

        def get_plan_dataset(self, key: str):
            raise app_flask.RaspiServerClientError(error_message)

        def get_part_locations(self, limit: int):
            raise app_flask.RaspiServerClientError(error_message)

    monkeypatch.setattr(app_flask, "_create_raspi_client", lambda: FailingClient())

    production_view = app_flask.build_production_view()

    assert production_view["plan_entries"], "フォールバックで生産計画を読み込めませんでした"
    assert "RaspberryPiServer" in (production_view["plan_error"] or "")


def test_fetch_part_locations_remote(monkeypatch, tmp_path):
    repo_root = _prepare_sample_data(tmp_path, monkeypatch)
    app_flask = _import_app_flask(repo_root)

    class StubClient:
        base_url = "http://raspi.local"

        def is_configured(self):
            return True

        def get_plan_dataset(self, key: str):
            raise app_flask.RaspiServerClientError("skip plan")

        def get_part_locations(self, limit: int):
            return {
                "entries": [
                    {
                        "order_code": "JOB-1",
                        "location_code": "RACK-1",
                        "device_id": "pi-zero",
                        "last_scan_id": "scan-123",
                        "scanned_at": "2025-01-05T12:00:00Z",
                        "updated_at": "2025-01-05T12:00:00Z",
                    }
                ]
            }

    monkeypatch.setattr(app_flask, "_create_raspi_client", lambda: StubClient())

    items = app_flask.fetch_part_locations(limit=5)

    assert len(items) == 1
    assert items[0]["order_code"] == "JOB-1"
    assert items[0]["location_code"] == "RACK-1"
