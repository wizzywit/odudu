---
title: odudu for Python
description: 'The Python package odudu: sync and async clients for the admin and me APIs, and a verifier for the access tokens a Python API receives.'
sidebar_position: 10
---

# odudu for Python

The Python package `odudu` has three parts. `odudu.admin` and `odudu.me` are typed clients for the admin API and the me API, each with a synchronous and an asynchronous form. `odudu.verify` checks the access tokens an API receives, by the rules of [`@odudu-io/node`](./node.md), and has helpers for FastAPI and Flask.

## Install

```text
pip install odudu
```

The package needs Python 3.10 or later and installs `httpx`, `attrs` and `typing-extensions`. The verifier needs PyJWT and cryptography, which the clients do not, so it is an extra, and so are the framework helpers:

```text
pip install 'odudu[verify]'
pip install 'odudu[fastapi]'
pip install 'odudu[flask]'
```

Importing `odudu` or `odudu.admin` never loads the verifier's dependencies.

## The shortest use

A service reads the tenant's clients with the admin client. This is [the Python example](https://github.com/wizzywit/odudu/tree/main/examples/python)'s `admin.py`, trimmed. The Python package has no token source of its own, so the example asks for a token with `httpx`.

```python
import httpx
from odudu.admin import AdminClient, iterate_pages
from odudu.admin.operations import get_admin_tenants_tenant_clients


def fetch_token() -> str:
    response = httpx.post(
        "https://id.example.com/tenants/acme/protocol/openid-connect/token",
        auth=("my-service", "the-client-secret"),
        data={"grant_type": "client_credentials", "resource": "urn:odudu:params:admin-api"},
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


with AdminClient("https://id.example.com", "acme", token=fetch_token) as admin:
    for item in iterate_pages(
        lambda page: (
            admin.call(
                get_admin_tenants_tenant_clients.sync_detailed, limit=page.limit, cursor=page.cursor
            ).parsed
        )
    ):
        print(getattr(item, "client_id", None))
```

An API checks the token a caller sends. This is `app.py` of the same example.

```python
from fastapi import Depends, FastAPI
from odudu.verify import AsyncVerifier, VerifiedToken
from odudu.verify.fastapi import require_token

verifier = AsyncVerifier(["https://id.example.com/tenants/acme"], "https://api.example.com")

app = FastAPI()


@app.get("/reports")
async def reports(
    token: VerifiedToken = Depends(require_token(verifier, scope="reports:read")),
) -> dict[str, object]:
    return {"caller": token.client_id or token.sub}
```

Both blocks are illustrative. The example they come from is run by the repository's CI against a live stack.

## What it exports

| Module                                          | What it holds                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `odudu`                                         | `ProblemError` and `FieldError`.                                                                                                                                 |
| `odudu.admin`, `odudu.me`                       | `AdminClient` and `AsyncAdminClient`, or `MeClient` and `AsyncMeClient`, with `iterate_pages`, `aiterate_pages`, `PageRequest`, `ProblemError` and `FieldError`. |
| `odudu.admin.operations`, `odudu.me.operations` | Every generated operation, for `client.call(operations.<name>.sync_detailed)`.                                                                                   |
| `odudu.admin.models`, `odudu.me.models`         | The request and response models.                                                                                                                                 |
| `odudu.verify`                                  | `Verifier`, `AsyncVerifier`, `VerifiedToken`, `VerificationError` and `KeyFetchError`.                                                                           |
| `odudu.verify.fastapi`                          | `require_token(verifier, scope=None)`, a FastAPI dependency.                                                                                                     |
| `odudu.verify.flask`                            | `require_token(verifier, scope=None)`, a decorator, and `current_token()`.                                                                                       |

`client.call(operation, *args, **kwargs)` runs a generated `sync_detailed` function (`asyncio_detailed` with `await` on the asynchronous client). The client supplies the tenant, the `client` argument, the token and the transport, so a call names only what the operation itself takes. Passing `client` or `tenant` raises `TypeError`. `client.http` is the configured `httpx.Client`, for an endpoint no generated operation covers; it signs, retries and raises like a generated call and refuses another origin.

## Options

### The clients

`AdminClient(base_url, tenant, token, *, transport=None, sleep=time.sleep, timeout=30.0)`, and the same for `MeClient`. The asynchronous clients take `asleep` in place of `sleep`.

| Argument    | What it does                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base_url`  | The origin and base path of the server. An absolute http or https URL. Use https: an `http` base URL sends the token in the clear.                        |
| `tenant`    | The tenant every call is made in.                                                                                                                         |
| `token`     | An access token, or a function that returns one, called for every request. The asynchronous clients also take one that returns an awaitable.              |
| `transport` | An `httpx` transport, to replace the default.                                                                                                             |
| `sleep`     | Waits between retries.                                                                                                                                    |
| `timeout`   | Seconds httpx waits for each of connecting, sending, receiving and getting a connection from the pool; 30 when omitted. It does not bound the whole call. |

Use a client as a context manager, or call `close()`.

`iterate_pages(call, page_limit=50, max_items=10000)` yields the items of a list, one page at a time and at most `max_items` in all. `call` receives a `PageRequest` with `limit` and `cursor` and returns the page or the detailed response holding it. `aiterate_pages` is the same for an event loop. Both raise `ValueError` when `page_limit` or `max_items` is not a positive integer.

### The verifiers

`Verifier(issuers, audience, required_scope=None, jwks_ttl=300.0, *, now=time.time, http_client=None, allow_insecure_issuers=False, fetch_timeout=5.0)`, and `AsyncVerifier` with the same arguments and an `httpx.AsyncClient`.

| Argument                 | What it does                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `issuers`                | The issuers whose tokens the API accepts. A token's `iss` must equal one exactly, and keys are read for these only. |
| `audience`               | What this API is called in a token's `aud`.                                                                         |
| `required_scope`         | A scope every accepted token must carry. Its absence is a 403.                                                      |
| `jwks_ttl`               | Seconds an issuer's keys are kept.                                                                                  |
| `now`                    | Returns seconds since the epoch.                                                                                    |
| `http_client`            | Replaces the client that reads the keys. It is then yours to close.                                                 |
| `allow_insecure_issuers` | Accepts issuers that are not https, for a development server.                                                       |
| `fetch_timeout`          | Seconds in all to read an issuer's discovery document and key set together.                                         |

A verifier that made its own `httpx` client owns it: use it as a context manager (`async with` for `AsyncVerifier`), or call `close()` (`aclose()`). A client you pass is yours to close.

`verify(token)` returns a `VerifiedToken` with `sub`, `client_id`, `scope`, `audience` and `claims`. `Verifier` is for threads; `AsyncVerifier.verify` is awaited.

## Errors

Every response of the admin or me API that is not a 2xx, a redirect included, raises `odudu.ProblemError`. It has `status`, `code`, `title`, `detail`, `type`, `instance`, `errors` (a list of field errors) and `response`. `code` is the part after `#` of the problem `type` on the admin API and the `error` of a refusal on the me API. The response's body is empty, because a body that is not a problem document is never kept.

The verifier raises two errors, as in [`@odudu-io/node`](./node.md#errors):

- `VerificationError` means the token is at fault. It has `status` (401, or 403 for a missing scope), `code` (`invalid_token` or `insufficient_scope`), `reason`, `description` and `challenge`, the `WWW-Authenticate` value to send. The reasons are the same as in the Node package.
- `KeyFetchError` means the issuer's keys could not be read, so the token has not been judged. The API answers 503, not 401, so a client keeps a token that is fine.

Settings that could never work are refused when a client or verifier is made, with `ValueError` or `TypeError`: an issuer with a trailing slash (write it as the server does), an issuer that is not https without `allow_insecure_issuers`, a `required_scope` that is not one RFC 6749 scope token (empty, or with a space, a quote, a backslash or a line break), a `jwks_ttl` or `fetch_timeout` that is not positive, a `base_url` that is not an absolute http or https URL, and a `tenant` that is not a name.

## Security notes

- **Clients.** The token goes to one origin: redirects are never followed, so a token is never sent to another origin. A request is repeated at most twice, on 429, 500, 502, 503 or 504 or a network failure, waiting `Retry-After` seconds when the server names them and otherwise 0.2 seconds doubling, never over 5, and only for `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE` or a call that carries an `Idempotency-Key`. For the `POST` operations the document marks as idempotent the client adds a key, and a repeat carries the same one. `ProblemError` keeps each text field to 1,000 characters and at most 100 field errors, and reads at most 64 KiB of a body. A request body given as a stream cannot be sent twice, so give a body as bytes or text when the call may be retried.
- **Verifier rules.** Signature by the issuer's keys (RS256 and ES256), `iss`, `aud`, `typ`, expiry with 5 seconds of leeway, and an optional required scope. A token that names the account API's audience beside the API's own is refused.
- **Key selection is stricter than in Node.** An RSA key under 2048 bits and an EC key that is not on P-256 are ignored, so a token naming one is `unknown_key` (401), where Node answers `malformed` (401). The cap of 20 keys per issuer counts the usable keys, in document order.
- **Claims.** They are judged in the order `jose` judges them, with the same reasons. One difference: a huge integer `exp` or `iat` (such as `10**400`) is refused as `invalid_claims`, where Node reads it as infinity and accepts it.
- **https for keys.** A `jwks_uri` that is not https is refused with `KeyFetchError` for an https issuer. An http issuer, allowed with `allow_insecure_issuers`, may name an http one only on its own origin.
- **Reading keys has one budget.** A document over 1 MiB is refused and a redirect is never followed. `fetch_timeout` (5 seconds) covers discovery and the key set together. A server that stalls, or sends its headers a byte at a time, is cut at it with a `KeyFetchError`, and the verifier shuts down the sockets that read opened. A failed read is not repeated within 10 seconds, even when `jwks_ttl` is shorter. The client the verifier makes keeps no connection alive between refreshes. For a connection that a client you pass as `http_client` already holds in its pool, or one made by a custom transport that does not report its connections, the caller is released at the deadline and the worker waits for httpx's connect and read timeouts.
- **What a local check cannot see.** A signature check cannot know that a session ended or a token was revoked. Keep access tokens short, or use introspection where it matters.
- **Frameworks.** `AsyncVerifier` is bound to the first event loop that uses it: use one verifier per loop. The FastAPI dependency answers with FastAPI's own error body, `{"detail": {"error": ..., "error_description": ...}}`, which differs from the flat JSON body of the Flask decorator and of `@odudu-io/node`; the status and the `WWW-Authenticate` challenge are the contract. The Flask decorator takes synchronous views only: an `async def` view raises `TypeError`.

## Not in this package

- **A token source or a sign-in.** There is no equivalent of the token source or sign-in functions of [`@odudu-io/oidc`](./oidc.md). Get a token with your own request, as the example does with `httpx`.
- **No retries for a `POST` or `PATCH` without an `Idempotency-Key`**, as in [`@odudu-io/admin-client`](./admin-client.md).
- **Other frameworks.** The verifier works anywhere; the helpers cover FastAPI and Flask only.

## Examples and neighbours

[The Python example](https://github.com/wizzywit/odudu/tree/main/examples/python) has `admin.py` for the admin client and `app.py` for the verifier behind FastAPI. The source is in [`sdks/python`](https://github.com/wizzywit/odudu/tree/main/sdks/python).

The same jobs in TypeScript are [`@odudu-io/admin-client`](./admin-client.md), [`@odudu-io/me-client`](./me-client.md) and [`@odudu-io/node`](./node.md).
