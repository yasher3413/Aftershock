from __future__ import annotations

import json

import httpx
import pytest

from aftershock.bot.x import XClient, XError, oauth1_header
from aftershock.config import Settings

KEYS = dict(
    x_api_key="xvz1evFS4wEEPTGEFPHBog",
    x_api_secret="kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    x_access_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    x_access_secret="LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
)


def test_oauth1_signature_matches_x_docs_example() -> None:
    # The worked example on X's "Creating a signature" page.
    h = oauth1_header(
        "POST",
        "https://api.twitter.com/1.1/statuses/update.json",
        Settings(**KEYS),
        params={
            "include_entities": "true",
            "status": "Hello Ladies + Gentlemen, a signed OAuth request!",
        },
        nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        timestamp=1318622958,
    )
    assert h.startswith("OAuth ")
    assert 'oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"' in h


def test_keys_present() -> None:
    assert Settings(**KEYS).x_keys_present
    assert not Settings(**{**KEYS, "x_access_secret": ""}).x_keys_present


async def test_post_upload_delete_requests() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        path = req.url.path
        if path == "/2/media/upload":
            return httpx.Response(200, json={"data": {"id": "77", "media_key": "3_77"}})
        if path == "/2/media/metadata":
            return httpx.Response(200, json={"data": {"associated_metadata": True}})
        if path == "/2/tweets" and req.method == "POST":
            return httpx.Response(201, json={"data": {"id": "9", "text": "x"}})
        if path == "/2/tweets/9" and req.method == "DELETE":
            return httpx.Response(200, json={"data": {"deleted": True}})
        return httpx.Response(404)

    x = XClient(Settings(**KEYS), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    media = await x.upload_media(b"\x89PNG fake", "A goal")
    assert media == "77"
    up, meta = seen[0], seen[1]
    assert (up.method, str(up.url)) == ("POST", "https://api.x.com/2/media/upload")
    assert up.headers["content-type"].startswith("multipart/form-data")
    body = up.content
    assert b'name="media_category"' in body and b"tweet_image" in body and b"PNG fake" in body
    assert str(meta.url) == "https://api.x.com/2/media/metadata"
    assert json.loads(meta.content) == {"id": "77", "metadata": {"alt_text": {"text": "A goal"}}}

    assert await x.post("Hello", media_id="77") == "9"
    assert json.loads(seen[-1].content) == {"text": "Hello", "media": {"media_ids": ["77"]}}
    assert await x.post("Fix", reply_to="9") == "9"
    assert json.loads(seen[-1].content) == {"text": "Fix", "reply": {"in_reply_to_tweet_id": "9"}}
    await x.delete("9")
    assert (seen[-1].method, str(seen[-1].url)) == ("DELETE", "https://api.x.com/2/tweets/9")
    assert all(r.headers["authorization"].startswith("OAuth ") for r in seen)
    await x.aclose()


@pytest.mark.parametrize(("status", "retryable"), [(429, True), (503, True), (403, False)])
async def test_errors_are_classified(status: int, retryable: bool) -> None:
    x = XClient(
        Settings(**KEYS),
        httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(status, json={"title": "no"}))
        ),
    )
    with pytest.raises(XError) as err:
        await x.post("Hello")
    assert err.value.status == status and err.value.retryable is retryable
