---
title: Protect an API
description: Decide whether your API trusts the access token a caller sends, with @odudu-io/node or odudu for Python, and see each check the SDK makes.
sidebar_position: 7
---

# Protect an API

Callers reach your API with an access token in the `Authorization` header. Your API's job is to decide, on its own and without asking Odudu each time, whether to trust it. You will get a token to test with, protect a route with `@odudu-io/node`, and then read the token, find the keys that sign it and run the checks one at a time, so you know what the SDK decides for you.

You need the stack from the [quick start](../quick-start/index.mdx) with its `demo` tenant. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

## 2. Get a token to test with

Register a caller and ask for a token, the way [a service does](./machine-to-machine.md). A token a person's sign-in produced is checked the same way. The caller may ask for the scope `reports:read`, and it is registered for `http://localhost:8082` as an audience, which is what the API below will call itself. A token carries the audiences its client is registered for.

```sh {run}
CALLER_SECRET=$(openssl rand -hex 24)
```

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-api-caller --client-secret "$CALLER_SECRET" --grant-type client_credentials --client-credentials-scope reports:read --audience http://localhost:8082
```

```sh {run}
TOKEN=$(curl -fsS -u "my-api-caller:$CALLER_SECRET" --data-urlencode grant_type=client_credentials --data-urlencode scope=reports:read "$TENANT/protocol/openid-connect/token" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
```

## 3. Protect a route with the SDK

[`@odudu-io/node`](../sdks/node.md) decides whether to trust a token. It reads the tenant's published keys, checks the token, and answers a refusal with the status and the `WWW-Authenticate` challenge that [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) describes. Give it the issuers you trust and the audience your API goes by.

```text
npm install @odudu-io/node
```

Until the first release is published, the package is not on npm. Install it from a checkout of this repository by running `../_shared/install.sh . node` in the folder of [the API example](https://github.com/wizzywit/odudu/tree/main/examples/api); it needs Node 24 or later, which the package needs too.

The example is one file, `server.ts`. The verifier is made once, and it keeps the keys between requests.

From `examples/api/server.ts`:

```ts
// Checks the signature against the tenant's published keys, the issuer, the
// audience, the token type (which keeps an ID token out) and the expiry.
// `allowInsecureIssuers` lets it trust an http issuer; never set it in production.
const verifier = createVerifier({
  issuers: [ISSUER],
  audience: AUDIENCE,
  allowInsecureIssuers: true,
});
```

A route is wrapped with `withToken`, which calls your handler only for a token the verifier trusts, and hands the handler what it found in it. `scope` is what the route needs.

From `examples/api/server.ts`:

```ts
// A valid token without the scope is a 403, because the caller is known and
// not allowed; a 401 means the token itself is not trusted.
const reports = withToken(
  verifier,
  (_request, response, token) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ caller: token.clientId ?? token.sub, reports: ['q1', 'q2'] }));
  },
  { scope: 'reports:read', onError: (error) => console.error(String(error)) },
);
```

A token it cannot trust is a `401` whose body says only `invalid_token`; a token without the scope is a `403`; and when the tenant's keys cannot be read the answer is a `503` with `Retry-After`, so a caller keeps a token that is fine. For Express and Fastify, [`@odudu-io/node`](../sdks/node.md) has middleware of the same shape.

In Python, `odudu.verify` makes the same checks and has a dependency for FastAPI and a decorator for Flask.

```text
pip install 'odudu[fastapi]'
```

From `examples/python/app.py`:

```python
# Odudu names the tenant itself as the audience unless a client says otherwise. RFC 9068
# wants it to name this API: register the audience on the client and pass it here.
verifier = AsyncVerifier(
    [ISSUER], os.environ.get("API_AUDIENCE", ISSUER), allow_insecure_issuers=True
)
```

From `examples/python/app.py`:

```python
# A valid token without the scope is a 403, because the caller is known and not allowed; a 401
# means the token itself is not trusted.
@app.get("/reports")
async def reports(
    token: VerifiedToken = Depends(require_token(verifier, scope="reports:read")),  # noqa: B008
) -> dict[str, object]:
    return {"caller": token.client_id or token.sub, "reports": ["q1", "q2"]}
```

`allowInsecureIssuers` and `allow_insecure_issuers` let the verifier trust an `http` issuer such as your stack on localhost. A real API trusts an https issuer and never sets them.

By default the example's API goes by the tenant's own address, which Odudu puts in the audience of the access tokens here. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) wants the audience to name your API. The caller above is registered for `http://localhost:8082`, so start the example with that as its audience, in its folder:

```text
API_AUDIENCE=http://localhost:8082 npm start
```

Then call it with the token from step 2:

```text
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:8082/reports
```

The answer is `200` with the reports. A token without `reports:read` gets a `403`, and a token for another audience gets a `401`.

## 4. Read the token

A token has three parts joined by dots: a header, the claims and a signature. This helper decodes the first two. Give it the token and the part's number.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f"$2" | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

The header says how the token was signed and with which key.

```sh {run expect="RS256"}
decode "$TOKEN" 1
```

The claims say who issued it, who it is for and until when.

```sh {run expect="my-api-caller"}
decode "$TOKEN" 2
```

Reading a token is not trusting it. Anyone can write a token that looks like this. The next steps are what make one trustworthy.

## 5. Find the tenant's keys

Odudu publishes the public keys that verify its tokens at an address the discovery document names. The verifier reads that address once, keeps the keys for five minutes, and reads them again, at most once every ten seconds, when it meets a `kid` it does not know.

```sh {run expect="/certs"}
curl -fsS "$TENANT/.well-known/openid-configuration" | sed -n 's/.*"jwks_uri":"\([^"]*\)".*/\1/p'
```

The token's header names its key by `kid`. Check that the key is published.

```sh {run expect="is published"}
KID=$(decode "$TOKEN" 1 | sed -n 's/.*"kid":"\([^"]*\)".*/\1/p') && curl -fsS "$TENANT/protocol/openid-connect/certs" | grep -q "$KID" && echo "key $KID is published"
```

## 6. The checks the SDK makes

The verifier makes these checks on every request and refuses the request if any fails. It names the check that failed in a `reason` for your logs and never tells the caller more than `invalid_token` or `insufficient_scope`.

1. **The signature.** It is verified with the published key named by `kid`. Only RS256 and ES256 are accepted, so a token that says `none` or names an HMAC is refused before a key is looked up. (`bad_signature`, `unsupported_algorithm`, `unknown_key`)
2. **The type.** The header `typ` must be `at+jwt`. An ID token is signed with the same keys, and this is what keeps it out. (`wrong_type`)
3. **The issuer.** The `iss` claim must be the tenant you trust, exactly. (`wrong_issuer`)
4. **The expiry.** The `exp` claim must be in the future, with 5 seconds of tolerance. (`expired`)
5. **The audience.** The `aud` claim must name your API. (`wrong_audience`)
6. **The scope.** The `scope` claim must allow what the caller is doing, when the route names a scope. Its absence is a `403`. (`insufficient_scope`)

You can run three of them here. The issuer in the token must equal the issuer in the tenant's discovery document.

```sh {run expect="issuer matches"}
ISS=$(decode "$TOKEN" 2 | sed -n 's/.*"iss":"\([^"]*\)".*/\1/p') && DISCOVERED=$(curl -fsS "$TENANT/.well-known/openid-configuration" | sed -n 's/.*"issuer":"\([^"]*\)".*/\1/p') && test "$ISS" = "$DISCOVERED" && echo "issuer matches: $ISS"
```

The expiry must be ahead of the clock.

```sh {run expect="not expired"}
EXP=$(decode "$TOKEN" 2 | sed -n 's/.*"exp":\([0-9]*\).*/\1/p') && NOW=$(date +%s) && test "$EXP" -gt "$NOW" && echo "not expired: $((EXP - NOW)) seconds left"
```

The `aud` claim lists the audience the caller is registered for, `http://localhost:8082`, and the tenant's own address beside it. The token is for your API when your API's name is among them.

```sh {run expect="audience includes"}
decode "$TOKEN" 2 | grep -q '"http://localhost:8082"' && echo "audience includes http://localhost:8082"
```

The scope is among the ones the caller asked for.

```sh {run expect="reports:read"}
decode "$TOKEN" 2 | sed -n 's/.*"scope":"\([^"]*\)".*/\1/p'
```

[`@odudu-io/node`](../sdks/node.md#errors) lists every `reason`.

## 7. Notice what a local check cannot see

Checking a token yourself is fast, and it cannot know that a session just ended or that the token was revoked. Until the token's `exp`, a signature check still passes. For an API where that matters, ask Odudu: [token introspection](../reference/transcripts/request-paths/rp-initiated-logout.md#token-introspection-and-revocation) answers whether a token is still active, immediately. The SDK makes no introspection request. Keep access tokens short, as Odudu does by default at five minutes, and a local check is usually enough.

## Where to go next

- Get a token for a person with [Sign people in to a web app](./web-app.md) or [Sign people in to a single-page app](./single-page-app.md).
- Read what your API should do when a token is refused in [Read a refusal](./read-a-refusal.md).
