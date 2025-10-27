from __future__ import annotations

import importlib
from pathlib import Path

import pytest


def _reload_station_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STATION_CONFIG_PATH", str(tmp_path / "station.json"))
    if "station_config" in importlib.sys.modules:
        del importlib.sys.modules["station_config"]
    return importlib.import_module("station_config")


def test_station_config_remote_success(tmp_path, monkeypatch):
    module = _reload_station_config(tmp_path, monkeypatch)

    class StubClient:
        base_url = "http://raspi.local"

        def is_configured(self):
            return True

        def get_json(self, path, **kwargs):
            assert path == "/api/v1/station-config"
            return {
                "process": "切削",
                "available": ["切削", "検査"],
                "updated_at": "2025-01-01T00:00:00Z",
            }

        def post_json(self, path, payload):
            assert path == "/api/v1/station-config"
            return {
                "process": payload["process"],
                "available": payload["available"],
                "updated_at": "2025-01-02T00:00:00Z",
            }

    monkeypatch.setattr(module, "_create_client", lambda: StubClient())

    config = module.load_station_config()
    assert config["source"] == "raspi_server"
    assert config["process"] == "切削"
    assert config["available"] == ["切削", "検査"]

    updated = module.save_station_config(process="研磨", available=["研磨", "仕上げ"])
    assert updated["process"] == "研磨"
    assert updated["available"] == ["研磨", "仕上げ"]
    assert updated["source"] == "raspi_server"


def test_station_config_remote_fallback(tmp_path, monkeypatch):
    module = _reload_station_config(tmp_path, monkeypatch)

    class FailingClient:
        base_url = "http://raspi.local"

        def is_configured(self):
            return True

        def get_json(self, path, **kwargs):
            raise module.RaspiServerClientError("down")

        def post_json(self, path, payload):
            raise module.RaspiServerClientError("down")

    monkeypatch.setattr(module, "_create_client", lambda: FailingClient())

    config = module.load_station_config()
    assert config["source"] != "raspi_server"
    assert "RaspberryPiServer" in (config.get("error") or "")

    updated = module.save_station_config(process="検査", available=["検査"])
    assert updated["process"] == "検査"
    assert updated["source"] != "raspi_server"
    assert (tmp_path / "station.json").exists()
