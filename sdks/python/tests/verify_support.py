"""A scripted issuer for `httpx.MockTransport`, test keys and the shared token fixtures."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import datetime
import importlib
import ipaddress
import json
import os
import socket
import ssl
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType

import httpx
import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

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

    def __init__(
        self,
        mode: str,
        keys: list[Jwk] | None = None,
        delay: float = 1.5,
        tls: ssl.SSLContext | None = None,
        healthy_requests: int = 0,
    ) -> None:
        self.mode = mode
        self.tls = tls
        self.healthy_requests = healthy_requests
        self.served = 0
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
        scheme = "http" if self.tls is None else "https"
        return f"{scheme}://127.0.0.1:{self._listener.getsockname()[1]}"

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
            if self.tls is not None:
                connection = self.tls.wrap_socket(connection, server_side=True)
            request = connection.recv(65536)
            if self.mode == "reuse":
                self._reuse(connection, request)
            elif self.mode == "trickle":
                self._trickle(connection)
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

    def _trickle(self, connection: socket.socket) -> None:
        for byte in b"HTTP/1.1 200 OK\r\nx-padding: " + b"a" * 4000:
            if self._stop.is_set():
                return
            connection.sendall(bytes([byte]))
            time.sleep(0.05)

    def _reuse(self, connection: socket.socket, request: bytes) -> None:
        """Keeps connections alive and answers `healthy_requests` requests in all, then trickles."""
        while request:
            with self._guard:
                self.served += 1
                healthy = self.served <= self.healthy_requests
            if not healthy:
                self._trickle(connection)
                return
            self._answer(connection, request, keep_alive=True)
            request = connection.recv(65536)

    def _answer(self, connection: socket.socket, request: bytes, keep_alive: bool = False) -> None:
        if b"openid-configuration" in request:
            document: dict[str, object] = {"issuer": self.issuer, "jwks_uri": f"{self.issuer}/jwks"}
        else:
            if self.mode == "late":
                time.sleep(self.delay)
            document = {"keys": self.keys}
        body = json.dumps(document).encode()
        mode = "keep-alive" if keep_alive else "close"
        head = f"HTTP/1.1 200 OK\r\ncontent-length: {len(body)}\r\nconnection: {mode}\r\n\r\n"
        connection.sendall(head.encode() + body)

    def close(self) -> None:
        self._stop.set()
        self._listener.close()


def make_tls() -> tuple[ssl.SSLContext, ssl.SSLContext]:
    """A server context with a throwaway certificate for 127.0.0.1, and a client that trusts it."""
    private = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(private.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(private, hashes.SHA256())
    )
    pem = certificate.public_bytes(serialization.Encoding.PEM)
    key_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    with tempfile.TemporaryDirectory() as folder:
        chain = Path(folder) / "chain.pem"
        chain.write_bytes(pem + key_pem)
        server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server.load_cert_chain(str(chain))
    client = ssl.create_default_context(cadata=pem.decode())
    return server, client


class ConnectProxy:
    """A loopback HTTP proxy that tunnels every CONNECT to its target."""

    def __init__(self) -> None:
        self.active = 0
        self._guard = threading.Lock()
        self._listener = socket.socket()
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._listener.getsockname()[1]}"

    def _accept(self) -> None:
        while True:
            try:
                connection, _ = self._listener.accept()
            except OSError:
                return
            threading.Thread(target=self._tunnel, args=(connection,), daemon=True).start()

    def _tunnel(self, client: socket.socket) -> None:
        with self._guard:
            self.active += 1
        upstream: socket.socket | None = None
        try:
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = client.recv(4096)
                if not chunk:
                    return
                head += chunk
            host, _, port = head.split(b" ")[1].decode().partition(":")
            upstream = socket.create_connection((host, int(port)))
            client.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            pump = threading.Thread(target=self._pipe, args=(upstream, client), daemon=True)
            pump.start()
            self._pipe(client, upstream)
            pump.join(5)
        except OSError:
            return
        finally:
            client.close()
            if upstream is not None:
                upstream.close()
            with self._guard:
                self.active -= 1

    @staticmethod
    def _pipe(source: socket.socket, target: socket.socket) -> None:
        try:
            while data := source.recv(65536):
                target.sendall(data)
        except OSError:
            pass
        finally:
            for end in (source, target):
                with contextlib.suppress(OSError):
                    end.shutdown(socket.SHUT_RDWR)

    def close(self) -> None:
        self._listener.close()
