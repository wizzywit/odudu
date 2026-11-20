"""A scripted issuer for `httpx.MockTransport`, test keys and the shared token fixtures."""

from __future__ import annotations

import asyncio
import base64
import importlib
import json
import os
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

ISSUER = "https://id.example.test/tenants/demo"
API = "https://api.example.test"
NOW = 1_800_000_000.0

REPOSITORY = Path(__file__).resolve().parents[3]
FIXTURES = REPOSITORY / "sdks" / "node" / "test" / "fixtures"
Jwk = dict[str, object]


def in_checkout() -> bool:
    """True in a clone of the repository, where the shared fixtures live; not in an sdist."""
    return (REPOSITORY / "pnpm-workspace.yaml").is_file()


def read_fixture(name: str) -> object:
    path = FIXTURES / name
    if not path.is_file():
        pytest.fail(f"the shared token fixture {path} is missing from this checkout")
    return json.loads(path.read_text(encoding="utf-8"))


def extra(name: str) -> ModuleType:
    """An optional extra's module. CI sets ODUDU_REQUIRE_EXTRAS so a missing one fails there."""
    if os.environ.get("ODUDU_REQUIRE_EXTRAS"):
        return importlib.import_module(name)
    module: ModuleType = pytest.importorskip(name)
    return module


@dataclass
class SigningKey:
    kid: str
    private: ec.EllipticCurvePrivateKey
    jwk: Jwk


def _coordinate(value: int) -> str:
    return base64.urlsafe_b64encode(value.to_bytes(32, "big")).rstrip(b"=").decode()


def make_key(kid: str) -> SigningKey:
    private = ec.generate_private_key(ec.SECP256R1())
    # Built here, with fixed-width coordinates: PyJWT 2.8's `to_jwk` drops leading zero bytes.
    numbers = private.public_key().public_numbers()
    jwk: Jwk = {
        "kty": "EC",
        "crv": "P-256",
        "x": _coordinate(numbers.x),
        "y": _coordinate(numbers.y),
        "kid": kid,
        "alg": "ES256",
        "use": "sig",
    }
    return SigningKey(kid, private, jwk)


def mint(
    key: SigningKey,
    *,
    issuer: str = ISSUER,
    audience: str | list[str] = API,
    now: float = NOW,
    scope: str = "reports:read",
    claims: dict[str, object] | None = None,
    typ: str | None = "at+jwt",
    alg: str = "ES256",
) -> str:
    payload: dict[str, object] = {
        "iss": issuer,
        "sub": "subject-1",
        "aud": audience,
        "client_id": "client-1",
        "scope": scope,
        "iat": int(now),
        "exp": int(now) + 300,
        **(claims or {}),
    }
    headers: dict[str, object] = {"kid": key.kid}
    if typ is not None:
        headers["typ"] = typ
    return jwt.encode(payload, key.private, algorithm=alg, headers=headers)


@dataclass
class Clock:
    now: float = NOW

    def __call__(self) -> float:
        return self.now


@dataclass
class IssuerServer:
    """Answers an issuer's discovery document and its JWK Set, and counts the requests."""

    keys: list[Jwk]
    issuer: str = ISSUER
    jwks_status: int = 200
    jwks_headers: dict[str, str] = field(default_factory=dict)
    jwks_body: bytes | None = None
    discovery_issuer: str | None = None
    redirect_to: str | None = None
    discovery_requests: int = 0
    jwks_requests: int = 0
    requested: list[str] = field(default_factory=list)
    release: threading.Event | None = None
    async_release: asyncio.Event | None = None

    def _answer(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requested.append(url)
        if self.redirect_to is not None and url.endswith("/jwks"):
            self.jwks_requests += 1
            return httpx.Response(302, headers={"location": self.redirect_to})
        if url == f"{self.issuer}/.well-known/openid-configuration":
            self.discovery_requests += 1
            document = {
                "issuer": self.discovery_issuer or self.issuer,
                "jwks_uri": f"{self.issuer}/jwks",
            }
            return httpx.Response(200, json=document)
        if url == f"{self.issuer}/jwks":
            self.jwks_requests += 1
            if self.jwks_status != 200:
                return httpx.Response(self.jwks_status)
            if self.jwks_body is not None:
                return httpx.Response(200, content=self.jwks_body, headers=self.jwks_headers)
            return httpx.Response(200, json={"keys": self.keys}, headers=self.jwks_headers)
        return httpx.Response(404)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.release is not None and request.url.path.endswith("/jwks"):
            self.release.wait(5)
        return self._answer(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    @property
    def client(self) -> httpx.Client:
        return httpx.Client(transport=self.transport)

    @property
    def async_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.answer_async))

    async def answer_async(self, request: httpx.Request) -> httpx.Response:
        if self.async_release is not None and request.url.path.endswith("/jwks"):
            await self.async_release.wait()
        return self._answer(request)


class SlowServer:
    """A real loopback HTTP server whose answers are slow, for deadline and cleanup tests.

    `trickle` sends the answer's headers one byte at a time, faster than any read timeout;
    `stall` sends nothing; `healthy` answers the discovery document and a key set at once; `late`
    does so but holds the key set back for `delay` seconds. `active` counts the connections
    still open on its side.
    """

    def __init__(self, mode: str, keys: list[Jwk] | None = None, delay: float = 1.5) -> None:
        self.mode = mode
        self.keys = keys or []
        self.delay = delay
        self.active = 0
        self._guard = threading.Lock()
        self._listener = socket.socket()
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen(64)
        self._stop = threading.Event()
        threading.Thread(target=self._accept, daemon=True).start()

    @property
    def issuer(self) -> str:
        return f"http://127.0.0.1:{self._listener.getsockname()[1]}"

    def _accept(self) -> None:
        while not self._stop.is_set():
            try:
                connection, _ = self._listener.accept()
            except OSError:
                return
            with self._guard:
                self.active += 1
            threading.Thread(target=self._serve, args=(connection,), daemon=True).start()

    def _serve(self, connection: socket.socket) -> None:
        try:
            request = connection.recv(65536)
            if self.mode == "trickle":
                for byte in b"HTTP/1.1 200 OK\r\nx-padding: " + b"a" * 4000:
                    if self._stop.is_set():
                        return
                    connection.sendall(bytes([byte]))
                    time.sleep(0.05)
            elif self.mode == "stall":
                while connection.recv(1024):
                    pass
            else:
                self._answer(connection, request)
        except OSError:
            return
        finally:
            connection.close()
            with self._guard:
                self.active -= 1

    def _answer(self, connection: socket.socket, request: bytes) -> None:
        if b"openid-configuration" in request:
            document: dict[str, object] = {"issuer": self.issuer, "jwks_uri": f"{self.issuer}/jwks"}
        else:
            if self.mode == "late":
                time.sleep(self.delay)
            document = {"keys": self.keys}
        body = json.dumps(document).encode()
        head = f"HTTP/1.1 200 OK\r\ncontent-length: {len(body)}\r\nconnection: close\r\n\r\n"
        connection.sendall(head.encode() + body)

    def close(self) -> None:
        self._stop.set()
        self._listener.close()
