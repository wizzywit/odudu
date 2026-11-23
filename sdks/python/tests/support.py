"""A scripted server for `httpx.MockTransport` and the calls the tests make."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

BASE_URL = "https://id.example.com"
TOKEN = "tok-secret-1"
PROBLEM_TYPE = "about:blank#idempotency-in-progress"

Reply = httpx.Response | Exception


@dataclass
class Server:
    """Answers each request with the next scripted reply and keeps what it saw."""

    replies: list[Reply] = field(default_factory=list)
    requests: list[httpx.Request] = field(default_factory=list)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception):
            raise reply
        return reply

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


@dataclass
class Sleeper:
    """Records the waits instead of making them."""

    waits: list[float] = field(default_factory=list)

    def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)

    async def asleep(self, seconds: float) -> None:
        self.waits.append(seconds)


def ok(body: object | None = None, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json={"items": []} if body is None else body)


def problem(status: int, **fields: object) -> httpx.Response:
    body: dict[str, object] = {
        "type": PROBLEM_TYPE,
        "title": "Conflict",
        "status": status,
        "instance": "/x",
        **fields,
    }
    return httpx.Response(status, json=body, headers={"content-type": "application/problem+json"})


def role(index: int) -> dict[str, object]:
    return {
        "id": f"r{index}",
        "name": f"role-{index}",
        "description": None,
        "client_id": None,
        "client_key": None,
        "default_for_new_subjects": False,
        "created_at": "2026-01-01T00:00:00Z",
        "admin_reach": [],
    }


def role_page(count: int, cursor: str | None = None, start: int = 0) -> httpx.Response:
    body: dict[str, object] = {"items": [role(start + i) for i in range(count)]}
    if cursor is not None:
        body["next"] = cursor
    return httpx.Response(200, json=body)


def consent_page(count: int, cursor: str | None = None) -> httpx.Response:
    items = [
        {"client_id": f"c{i}", "scope_names": ["openid"], "granted_at": "2026-01-01T00:00:00Z"}
        for i in range(count)
    ]
    return httpx.Response(200, json={"items": items, "next_cursor": cursor})


def query(request: httpx.Request) -> dict[str, str]:
    return dict(request.url.params)


def json_body(request: httpx.Request) -> object:
    return json.loads(request.content)


Handler = Callable[[httpx.Request], httpx.Response]
