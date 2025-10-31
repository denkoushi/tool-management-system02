from __future__ import annotations

from pathlib import Path

import pytest

from test_load_plan import _import_app_flask


@pytest.fixture()
def app_module(monkeypatch):
    repo_root = Path(__file__).resolve().parents[1]
    module = _import_app_flask(repo_root)
    monkeypatch.setattr(module, "API_TOKEN_ENFORCED", False)
    return module


def test_fetch_logistics_jobs_remote_success(monkeypatch, app_module):
    calls = {}

    class StubClient:
        def __init__(self):
            self.base_url = "http://raspi.local"

        def is_configured(self) -> bool:
            return True

        def get_json(self, path, params=None, **kwargs):
            calls["path"] = path
            calls["params"] = params
            return {
                "items": [
                    {
                        "job_id": "JOB-1",
                        "part_code": "PART-01",
                        "from_location": "倉庫",
                        "to_location": "加工",
                        "status": "pending",
                        "requested_at": "2025-10-31T10:00:00Z",
                        "updated_at": "2025-10-31T10:05:00Z",
                    }
                ]
            }

    monkeypatch.setattr(app_module, "_create_raspi_client", lambda: StubClient())

    jobs = app_module.fetch_logistics_jobs(limit=5)

    assert calls["path"] == "/api/logistics/jobs"
    assert calls["params"]["limit"] == 5
    assert jobs == [
        {
            "job_id": "JOB-1",
            "part_code": "PART-01",
            "from_location": "倉庫",
            "to_location": "加工",
            "status": "pending",
            "requested_at": "2025-10-31T10:00:00Z",
            "updated_at": "2025-10-31T10:05:00Z",
        }
    ]


def test_fetch_logistics_jobs_handles_missing_config(monkeypatch, app_module):
    class InactiveClient:
        def __init__(self):
            self.base_url = ""

        def is_configured(self) -> bool:
            return False

    monkeypatch.setattr(app_module, "_create_raspi_client", lambda: InactiveClient())
    assert app_module.fetch_logistics_jobs() == []


def test_api_logistics_jobs_list(monkeypatch, app_module):
    monkeypatch.setattr(app_module, "fetch_logistics_jobs", lambda limit: [{"job_id": "JOB-2"}])

    client = app_module.app.test_client()
    response = client.get("/api/logistics/jobs?limit=250")
    assert response.status_code == 200
    data = response.get_json()
    assert data["limit"] == 250
    assert data["items"][0]["job_id"] == "JOB-2"
