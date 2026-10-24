"""A small X API v2 client for the goal bot: upload an image, post, reply,
delete. Requests are signed with OAuth 1.0a as the bot account (the keys and
access token from the X developer console)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from typing import Any
from urllib.parse import quote

import httpx

from aftershock.config import Settings

API = "https://api.x.com/2"


class XError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"X API {status}: {detail}")
        self.status = status
        # Rate limits and server errors may pass; anything else will not.
        self.retryable = status == 429 or status >= 500


def _q(s: str) -> str:
    return quote(s, safe="~")


def oauth1_header(
    method: str,
    url: str,
    settings: Settings,
    *,
    params: dict[str, str] | None = None,
    nonce: str | None = None,
    timestamp: int | None = None,
) -> str:
    """The Authorization header. Only query or form parameters are signed;
    JSON and multipart bodies are not part of the signature."""
    oauth = {
        "oauth_consumer_key": settings.x_api_key,
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(timestamp if timestamp is not None else int(time.time())),
        "oauth_token": settings.x_access_token,
        "oauth_version": "1.0",
    }
    pairs = sorted((_q(k), _q(v)) for k, v in {**(params or {}), **oauth}.items())
    base = "&".join([method.upper(), _q(url), _q("&".join(f"{k}={v}" for k, v in pairs))])
    key = f"{_q(settings.x_api_secret)}&{_q(settings.x_access_secret)}"
    digest = hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()
    oauth["oauth_signature"] = base64.b64encode(digest).decode()
    return "OAuth " + ", ".join(f'{_q(k)}="{_q(v)}"' for k, v in sorted(oauth.items()))


class XClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client or httpx.AsyncClient(timeout=20)

    async def _call(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        url = f"{API}{path}"
        r = await self.client.request(
            method, url, headers={"Authorization": oauth1_header(method, url, self.settings)}, **kw
        )
        if r.status_code >= 400:
            raise XError(r.status_code, r.text[:300])
        data: dict[str, Any] = r.json().get("data", {}) if r.content else {}
        return data

    async def upload_media(self, png: bytes, alt: str) -> str:
        data = await self._call(
            "POST",
            "/media/upload",
            files={"media": ("card.png", png, "image/png")},
            data={"media_category": "tweet_image"},
        )
        media_id = str(data["id"])
        await self._call(
            "POST",
            "/media/metadata",
            json={"id": media_id, "metadata": {"alt_text": {"text": alt[:1000]}}},
        )
        return media_id

    async def post(
        self, text: str, *, media_id: str | None = None, reply_to: str | None = None
    ) -> str:
        body: dict[str, Any] = {"text": text}
        if media_id:
            body["media"] = {"media_ids": [media_id]}
        if reply_to:
            body["reply"] = {"in_reply_to_tweet_id": reply_to}
        return str((await self._call("POST", "/tweets", json=body))["id"])

    async def delete(self, post_id: str) -> None:
        await self._call("DELETE", f"/tweets/{post_id}")

    async def aclose(self) -> None:
        await self.client.aclose()
