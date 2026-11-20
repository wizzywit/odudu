# odudu

Typed Python clients for the Odudu admin API and the account
(`me`) API, with a synchronous and an asynchronous client for each.

```python
from odudu.admin import AdminClient, iterate_pages
from odudu.admin.operations import get_admin_tenants_tenant_clients

with AdminClient("https://id.example.com", "acme", token=lambda: fetch_token()) as admin:
    for client in iterate_pages(
        lambda page: (
            admin.call(
                get_admin_tenants_tenant_clients.sync_detailed, limit=page.limit, cursor=page.cursor
            ).parsed
        )
    ):
        print(client.client_id)
```

Every response that is not a success raises `odudu.ProblemError`. Redirects are never followed, so
a token is never sent to another origin. `python>=3.10`, `httpx`.

## Verifying access tokens

`pip install 'odudu[verify]'` adds `odudu.verify`, which checks the access tokens (RFC 9068) an
API receives, with the rules of `@odudu-io/node`: signature by the issuer's keys (RS256 and
ES256), `iss`, `aud`, `typ`, expiry with 5 s of leeway, an optional required scope. A refusal is a
`VerificationError` holding the status and the `WWW-Authenticate` challenge; keys that cannot be
read raise `KeyFetchError`, which an API answers with a 503.

```python
from odudu.verify import Verifier

verifier = Verifier(["https://id.example.com/tenants/acme"], "https://api.example.com")
token = verifier.verify(bearer_token)  # VerifiedToken: sub, client_id, scope, audience, claims
```

`AsyncVerifier` is the same for an event loop (`await verifier.verify(...)`).
`pip install 'odudu[fastapi]'` adds `odudu.verify.fastapi.require_token(verifier, scope=...)`, a
dependency, and `pip install 'odudu[flask]'` adds the decorator `odudu.verify.flask.require_token`.

Notes on the verifier:

- Key selection is stricter than `@odudu-io/node`: an RSA key under 2048 bits and an EC key that
  is not on P-256 are ignored, so a token naming one is `unknown_key` (401) where Node answers
  `malformed` (401). The cap of 20 keys per issuer counts the usable keys, in document order.
- `AsyncVerifier` is bound to the first event loop that uses it; use one verifier per loop.
- The FastAPI dependency answers with FastAPI's own error body, `{"detail": {"error": ...,
"error_description": ...}}`, which differs from the flat JSON body of the Flask decorator and
  of `@odudu-io/node`. The status and the `WWW-Authenticate` challenge are the contract.
- The Flask decorator takes synchronous views only; decorating an `async def` view raises
  `TypeError`.
- Claims are judged in the order `jose` judges them, with the same reasons. One difference: a
  huge integer `exp` or `iat` (such as 10**400) is refused as `invalid_claims`, where Node reads
  it as Infinity and accepts it.
- Reading an issuer's keys, discovery and key set together, has one budget (`fetch_timeout`, 5 s).
  A server that stalls or sends its headers a byte at a time is cut at it with a `KeyFetchError`.
- When a read runs out of time the verifier shuts down the sockets of that read, so the worker
  thread ends and its connection leaves the pool. This works with httpx's own transports, a
  client you pass included; a custom transport that does not report its connections to httpcore
  is left to httpx's phase timeouts. A failed read is not repeated within 10 s, even when
  `jwks_ttl` is shorter (Node repeats it after the TTL then).
