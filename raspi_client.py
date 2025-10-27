"""RaspberryPiServer REST client helpers."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Iterable, Optional

import requests
from requests import Response

DEFAULT_TIMEOUT = float(os.getenv("RASPI_SERVER_TIMEOUT", "4.0"))


class RaspiServerClientError(Exception):
    """Base error for client operations."""


class RaspiServerAuthError(RaspiServerClientError):
    """Raised when authentication fails."""


class RaspiServerConfigError(RaspiServerClientError):
    """Raised when base URL is not configured."""


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
        return None
    return None


@dataclass
class RaspiServerClient:
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

    def get_json(
        self,
        path: str,
        *,
        allow_statuses: Iterable[int] | None = None,
        params: dict | None = None,
    ) -> dict:
        response = self._request("GET", path, params=params, allow_statuses=allow_statuses)
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            raise RaspiServerClientError(f"invalid JSON response from {path}") from exc

    def post_json(self, path: str, payload: dict | None = None) -> dict:
        response = self._request("POST", path, json=payload)
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            raise RaspiServerClientError(f"invalid JSON response from {path}") from exc

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
        allow_statuses: Iterable[int] | None = None,
    ) -> Response:
        if not self.is_configured():
            raise RaspiServerConfigError("RASPI_SERVER_BASE is not configured")

        url = f"{self.base_url}{path}"
        session = self.session or requests.Session()
        headers = {}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        try:
            response = session.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise RaspiServerClientError(str(exc)) from exc

        allowed = set(allow_statuses or ())
        if response.status_code == 401:
            raise RaspiServerAuthError("invalid API token")
        if allowed and response.status_code in allowed:
            return response
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise RaspiServerClientError(str(exc)) from exc
        return response
