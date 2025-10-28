from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("relative_path", "required_keys"),
    [
        (
            "config/window-a-client.env.sample",
            {
                "RASPI_SERVER_BASE",
                "RASPI_SERVER_API_TOKEN",
                "DOCUMENT_VIEWER_URL",
                "UPSTREAM_SOCKET_BASE",
                "UPSTREAM_SOCKET_PATH",
                "UPSTREAM_SOCKET_AUTO",
            },
        )
    ],
)
def test_env_sample_contains_required_keys(relative_path: str, required_keys: set[str]) -> None:
    env_path = REPO_ROOT / relative_path
    assert env_path.exists(), f"Sample env file not found: {env_path}"

    found_keys = set()
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key = line.split("=", 1)[0].strip()
        if key:
            found_keys.add(key)

    missing = required_keys - found_keys
    assert not missing, f"Missing keys in {env_path}: {sorted(missing)}"
