"""Client utilities for interacting with RaspberryPiServer REST endpoints."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional

try:
    import requests
    from requests import Response
except ModuleNotFoundError as exc:  # pragma: no cover - requests should be installed
    raise RuntimeError("raspi_server_client requires the 'requests' package") from exc


DEFAULT_TIMEOUT = float(os.getenv("RASPI_SERVER_TIMEOUT", "4.0"))


class RaspiServerClientError(Exception):
    """Base error for RaspberryPiServer client operations."""


class RaspiServerConfigError(RaspiServerClientError):
    """Raised when the client is not configured with a base URL."""


class RaspiServerAuthError(RaspiServerClientError):
    """Raised when the RaspberryPiServer API rejected the provided token."""


def _coerce_base_url(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.rstrip("/")


def _resolve_token() -> Optional[str]:
    direct = os.getenv("RASPI_SERVER_API_TOKEN") or os.getenv("RASPI_SERVER_TOKEN")
    if direct:
        return direct.strip()
    try:
        from api_token_store import get_token_info  # pylint: disable=import-outside-toplevel

        info = get_token_info()
        token = info.get("token")
        if token:
            return str(token).strip()
    except Exception:
        # token 情報が取得できなくてもフェイルセーフに戻す
        return None
    return None


@dataclass
class RaspiServerClient:
    """Small helper around requests.Session for RaspberryPiServer REST API."""

    base_url: str
    token: Optional[str]
    timeout: float = DEFAULT_TIMEOUT
    session: requests.Session | None = None

    @classmethod
    def from_env(cls) -> "RaspiServerClient":
        base_url = _coerce_base_url(os.getenv("RASPI_SERVER_BASE"))
        token = _resolve_token()
        return cls(base_url=base_url, token=token, timeout=DEFAULT_TIMEOUT)

    def is_configured(self) -> bool:
        return bool(self.base_url)

    # --- REST calls -----------------------------------------------------
    def get_plan_dataset(self, key: str) -> Dict[str, Any]:
        path = {
            "production_plan": "/api/v1/production-plan",
            "standard_times": "/api/v1/standard-times",
        }.get(key)
        if not path:
            raise ValueError(f"unsupported dataset: {key}")
        return self._json_request("GET", path, allow_statuses={200, 404})

    def get_part_locations(self, limit: int = 200) -> Dict[str, Any]:
        params = {"limit": limit}
        return self._json_request("GET", "/api/v1/part-locations", params=params)

    def get_station_config(self) -> Dict[str, Any]:
        return self._json_request("GET", "/api/v1/station-config")

    def update_station_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._json_request("POST", "/api/v1/station-config", json=payload)

    # --- Internal helpers -----------------------------------------------
    def _json_request(
        self,
        method: str,
        path: str,
        *,
        allow_statuses: Optional[Iterable[int]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        response = self._request(method, path, allow_statuses=allow_statuses, **kwargs)
        try:
            return response.json()
        except json.JSONDecodeError as exc:  # pragma: no cover
            raise RaspiServerClientError(f"invalid JSON response from {path}") from exc

    def _request(
        self,
        method: str,
        path: str,
        *,
        allow_statuses: Optional[Iterable[int]] = None,
        **kwargs: Any,
    ) -> Response:
        if not self.is_configured():
            raise RaspiServerConfigError("RASPI_SERVER_BASE is not configured")

        url = f"{self.base_url}{path}"
        session = self.session or requests.Session()
        headers = kwargs.pop("headers", {})
        token = self.token
        if token:
            headers.setdefault("Authorization", f"Bearer {token}")
        timeout = kwargs.pop("timeout", self.timeout)

        try:
            response = session.request(method, url, headers=headers, timeout=timeout, **kwargs)
        except requests.RequestException as exc:
            raise RaspiServerClientError(str(exc)) from exc

        allowed = set(allow_statuses or ())
        if response.status_code == 401:
            raise RaspiServerAuthError("RaspberryPiServer rejected the provided token")
        if allowed and response.status_code in allowed:
            return response
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RaspiServerClientError(str(exc)) from exc
        return response

