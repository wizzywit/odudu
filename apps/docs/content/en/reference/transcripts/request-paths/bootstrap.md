---
title: 'Bootstrap'
description: "A tenant, its first user and its signing key are created by the server's seed command — the only way to create the first of anything, since the…"
---

# Bootstrap

A tenant, its first user and its signing key are created by the server's
seed command — the only way to create the first of anything, since the
[admin API](../admin-paths/index.md) needs an administrator who needs a tenant.
Everything after that first row has two more doors: the admin API, and, for
a client on a tenant that opens registration to it,
[dynamic client registration](#dynamic-client-registration). This document
seeds, because a seed command is reproducible from a shell with no token in
it; [the admin paths](../admin-paths/index.md) walks the same ground through the
API.

## Pick how you are running it

[Run it from a checkout](../../../contributing/run-from-a-checkout.md) describes
three ways to run this: everything in Docker, Postgres in Docker with the server
on your host, and everything on your host against a PostgreSQL you operate. They
differ in exactly one thing this document depends on — **how the seed command is
invoked** — because the container runs a built bundle and a host run has the
source.

So the rest of this document calls the CLI through a shell function named
`odudu`. Define it once for the way you are running, from the repository
root, and every command below is the same command in all three.

**Everything in Docker.** The CLI is the bundle inside the running
container, and the configuration both it and the server read is
`infra/docker/.env`; the repository-root `.env` plays no part.

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
cd ../..
odudu() { docker compose -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
```

```
{"status":"ok","checks":{"database":"ok"}}
```

**Server on your host**, against either Postgres. Node runs the TypeScript
source directly, and `--env-file` hands it the repository-root `.env` — the
same file the `dev` script loads, so the CLI and the server it is seeding
for read one configuration.

```bash
pnpm --filter @odudu/server dev            # leave running in another terminal
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done

odudu() { node --env-file=.env apps/server/src/main.ts "$@"; }
```

```
{"status":"ok","checks":{"database":"ok"}}
```

What else the choice settles:

| What it settles                                | Everything in Docker              | Server on your host                           |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------- |
| What the CLI executes                          | the bundle built into the image   | the TypeScript source, types stripped by Node |
| Configuration the server and the CLI both read | `infra/docker/.env`               | the repository-root `.env`                    |
| Base URL of every endpoint                     | `http://localhost:3000`           | `http://localhost:3000`                       |
| PostgreSQL                                     | compose's, published on port 5442 | compose's on 5442, or one you run yourself    |

The base URL is the same in all three, so no URL below is mode-specific:
compose publishes `127.0.0.1:3000:3000`, and a host run defaults to the same
port. Run only one of them at a time — they compete for it.

The readiness loop is not decoration, in either mode. `docker compose up -d`
returns when the container has started, which is before it has finished
applying migrations, and the `dev` script returns the shell immediately for
the same reason. **The seed command does not run migrations**; it expects a
schema the server put there on boot, and a seed run in that gap fails with
`relation "tenants" does not exist`.

Running everything on your host needs the database and the restricted serving
role to exist before any of this — one `CREATE DATABASE` and one `CREATE USER`,
in [Run it from a
checkout](../../../contributing/run-from-a-checkout.md),
against a PostgreSQL whose owner role can `CREATE ROLE`. Nothing after that
bootstrap differs from the second column above. The no-Docker run below used a
throwaway cluster made for it — `initdb -D /tmp/odudu-pg -U postgres`, started
with `pg_ctl` on port 5616, PostgreSQL 18.6 — rather than the compose stack, so
that "no Docker at all" meant it.

## The key that has to be the same on both sides

`ODUDU_KEK` wraps each tenant's private signing key. It is read from whichever
configuration the process holds, so **the thing that seeded a tenant and the
thing serving it must hold the same value** — and the two files ship
_different_ ones: `infra/docker/.env.example` carries a throwaway key, and
the root `.env.example` leaves it empty for you to generate.

Seeding under compose and then serving from your host is the easy accident:
both processes are pointed at the same database, and only the key differs.
It does not fail where you would look for it. Discovery and JWKS answer `200`,
`/authorize` renders the login form, the login POST returns a code — and
then:

```
HTTP/1.1 500 Internal Server Error
content-type: application/problem+json; charset=utf-8

{"type":"about:blank","title":"Internal Server Error","status":500,"instance":"01a17a82-208e-…"}
```

(That response is from a host run: a second server process started from the source with
`node --env-file`, an `ODUDU_KEK` generated for it rather than the first process's, and the
same database, serving the tenant the first process had seeded. The `instance` is the
request's id, shortened.)

That is the private key failing to unwrap, and it names neither the key nor
the reason. Before seeding anything, copy the `ODUDU_KEK` line from
`infra/docker/.env` into the root `.env` if you intend to move between the
two. Changing the value afterwards strands every key already wrapped with
the old one — a tenant seeded under one key cannot be served under another,
and there is no rotation path yet.

## A public client, with a user

A public client has no secret. It proves itself with PKCE alone, which is
what a browser or mobile application should be.

```bash
odudu seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{
  "created": true,
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a0cb07-…"
}
```

(`tenantId` and `userSubjectId` are generated identifiers; shortened here.
`userSubjectId` is present whenever `--user` names one, whether this run
created it or found it already seeded — [Address verification](./path-a-as-a-confidential-client.md#address-verification)
below is what it is for.)

`--redirect-uri` may be repeated. It is matched by exact string comparison
when a request arrives — no trailing-slash tolerance, no case folding, no
ignoring the query string, because every normalization widens what an
attacker can aim at. `--email` is optional; without it the `email` and
`email_verified` claims are omitted together rather than an empty address
being asserted with a verification status.

Seeding asserts a whole desired state, so a re-run with identical arguments
reports that it changed nothing:

```bash
odudu seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{
  "created": false,
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a0cb07-…"
}
```

while a re-run that disagrees with what is stored refuses rather than
overwriting or silently ignoring the difference:

```bash
odudu seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password wrong-password --email ada@example.com
```

```
OduduError: user ada already exists with a different password
  code: 'seed_conflict'
```

(exit status 1; the Node stack trace between those two lines is elided.)

## A confidential client

A confidential client has a secret and is registered for exactly one way of
presenting it. `--token-endpoint-auth-method` picks that way; omitted, it is
`client_secret_basic`.

```bash
odudu seed \
  --tenant demo --client demo-backend --client-secret demo-backend-secret \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri http://localhost:8080/callback
```

```json
{ "created": true, "tenant": "demo", "tenantId": "01a0cb07-…", "clientId": "demo-backend" }
```

```bash
odudu seed \
  --tenant demo --client demo-post --client-secret demo-post-secret \
  --token-endpoint-auth-method client_secret_post \
  --redirect-uri http://localhost:8080/callback
```

```json
{ "created": true, "tenant": "demo", "tenantId": "01a0cb07-…", "clientId": "demo-post" }
```

A confidential client is also given a service-account subject, which is what
makes `client_credentials` possible for it (Path C). A public client gets
none, and asking for that grant with one is refused.

The method is registered, not negotiated: `demo-post` must send its secret
in the body and `demo-backend` must send it in the `Authorization` header.
Each is refused if it uses the other's method, even with the right secret —
see the `/token` table in [The branches](./the-branches.md).

Both seed runs above create the tenant's first signing key if it has none.
`--user` and `--password` go together or not at all, and `--email` needs a
user to belong to. Seeding never adds a user to a client that already
exists — it would exit 0 having done nothing, which is worse than refusing.

Two caveats on the command itself. `--client-secret` and `--password` are
plain command-line flags, so they land in `ps` output and shell history:
that is acceptable for a local bootstrap run by an operator who already
controls the machine, and is not something to carry into CI. And the seeded
values above are demonstration values in this document; choose your own.

## The shell variables the rest of this document uses

Every command below is a real command, and several need a value produced by
an earlier one — `$CODE`, `$VERIFIER`, `$ACCESS_TOKEN`. Paste this into the
shell you are working in and they are all defined. It is Path A, run
without a browser: the browser's only job in that flow is to follow a
redirect and submit a form, and `curl` does both.

```bash
BASE=http://localhost:3000/tenants/demo/protocol/openid-connect
LOGIN=http://localhost:3000/tenants/demo/login-actions/authenticate

VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode 'nonce=n-0S6_WzA2Mj' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

CODE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

TOKENS=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" "$BASE/token")

ACCESS_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
ID_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"id_token":"\([^"]*\)".*/\1/p')
REFRESH_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')
```

Two things to know before reusing it. A `$CODE` is spent by the successful
redemption above and lives only 60 seconds anyway, so every experiment on
`/token` that needs an unspent one needs the first three blocks run again.
And `$AUTH_SESSION_ID` is consumed by a successful login, so the same goes
for experiments on the login form.

`infra/docker/smoke.sh` is the same sequence with assertions after each
step; read it if you would rather have something that fails loudly. It
brings the compose stack up and tears it down again, volumes included, so it
is the all-Docker way of running whichever one you picked above — and it
will take port 3000 and the stack's database with it.

## Dynamic client registration

This section runs against a tenant of its own, so nothing it registers lands
in `demo`. `seed tenant` creates one with every setting at its default:

```bash
odudu seed tenant --name reg-demo
```

```json
{ "command": "tenant", "created": true, "tenant": "reg-demo", "tenantId": "01a0cb08-2747-…" }
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/tenants/reg-demo/.well-known/openid-configuration
```

```
200
```

Registration accepts, beside the redirect and authentication metadata the
transcripts below register, RFC 7591's `client_uri`, `policy_uri` and `tos_uri`
(absolute https, or http on a loopback host, no fragment — the consent screen
links them, [The client's own
pages](./rp-initiated-logout.md#the-clients-own-pages)) and OpenID Connect
Dynamic Client Registration §2's `id_token_signed_response_alg` (an algorithm a
non-retired key of the tenant produces), `default_max_age` and
`require_auth_time`; a response echoes each one registered, and none that was
not. No transcript here registers them; integration tests do.

`client_registration_policy` is `disabled` on every tenant by default (ADR
0026). Registering before it is opened, or against a tenant that does not
exist, answers the same way — an enumeration oracle costs nothing to close
here, the same reasoning `/token` and `/userinfo` apply to a disabled
tenant. The discovery `200` above is what tells the two apart: the first
refusal below is the closed policy, not an absent tenant.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"]}'
```

```
404
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/tenants/no-such-tenant/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"]}'
```

```
404
```

Opening it is a tenant setting like any other:

```bash
odudu seed tenant --name reg-demo --set client_registration_policy=open
```

```json
{
  "command": "tenant",
  "created": false,
  "tenant": "reg-demo",
  "tenantId": "01a0cb08-2747-…",
  "settings": ["client_registration_policy"]
}
```

Discovery now advertises the endpoint, and any request registers a client —
the `open` policy is RFC 7591 §3.1's anonymous case. The server assigns
`client_id`; a `client_secret` is generated for a confidential client (the
default — `token_endpoint_auth_method` defaults to `client_secret_basic`)
and returned **exactly once, in this response**. `clients.secret_hash`
stores its Argon2id hash; there is no way to retrieve the plaintext again.

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name":"Example RP"}'
```

```json
{
  "client_id": "01a0cb08-2958-…",
  "client_id_issued_at": 1790112704,
  "client_secret": "BvE93j7HNH4luJx0BBMi9k5sPlUXNafEsyCQPKkEPRM",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "client_name": "Example RP"
}
```

This registration presented no credential, so `registration_origin` is
`'anonymous'` and `consent_required` defaults `true` on the row it wrote
(ADR 0027) — an anonymous registrant is not the operator vouching for a
client the way `seed client` or a token-authorized registration is.

The `token` policy is stricter: a request with no bearer credential is
refused before anything is validated, with `WWW-Authenticate` naming the
scheme and no `error` parameter (RFC 6750 §3.1's distinction between an
absent credential and a rejected one).

```bash
odudu seed tenant --name reg-demo --set client_registration_policy=token
```

```bash
curl -sS -D - -o /dev/null -X POST \
  http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["https://rp.example/cb"]}' \
  | grep -iE '^HTTP|www-authenticate'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="client-registration"
```

`seed registration-token` mints the credential a registrant presents:
`--uses` bounds how many registrations it is good for, `--ttl` its lifetime
in seconds, and both are required since the schema has no default for
either. Every other seed subcommand answers with a line of JSON; this one
answers with the token alone, so `TOKEN=$(odudu seed registration-token …)`
captures exactly the credential and nothing else. The admin API mints the
same way, for an operator who would rather not shell into the container:
`POST /admin/tenants/{tenant}/registration-tokens` (`manage-clients`),
documented in [the admin paths](../admin-paths/index.md).

```bash
TOKEN=$(odudu seed registration-token --tenant reg-demo --uses 1 --ttl 3600)
```

```
j4B_nsJYIJSe8AgjA9xVsFU28J6L67yYzVinAYXXP4w
```

It is stored as its SHA-256 digest, the same shape the account action tokens
use, and spent by one `UPDATE … RETURNING` so two concurrent registrations
against a one-use token cannot both win — answering the request and consuming
the token happen in the one transaction that inserts the client, never earlier.
Presenting it registers a client whose `registration_origin` is `'token'`, with
`consent_required` defaulting `false`: an initial access token is an operator's
own authorization, as much as `seed client` naming a client directly is.

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp2.example/cb"],"token_endpoint_auth_method":"none"}'
```

```json
{
  "client_id": "01a0cb08-2c63-…",
  "client_id_issued_at": 1790112705,
  "redirect_uris": ["https://rp2.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "none"
}
```

`token_endpoint_auth_method: "none"` names a public client, so no secret is
generated or returned — RFC 6749 §10.1 gives no client that cannot keep one
confidential a credential to keep.

A tenant at its `max_clients` cap refuses further registration with 403 and
`invalid_client_metadata`, taken under `SELECT … FOR UPDATE` on the tenant row
before the count so two concurrent registrations cannot both observe room that
only one of them will actually get.

A registered `backchannel_logout_uri` is stored, echoed back in the registration
response, and now read: discovery advertises `backchannel_logout_supported` and
its front-channel twin for every tenant (see
[discovery](./path-a-authorization-code-with-pkce.md#1-discovery) above), and
ending a session delivers to it (see [front-channel and back-channel
logout](./rp-initiated-logout.md#front-channel-and-back-channel-logout) below).
`userinfo_signed_response_alg` is stored, echoed, and now read: a client that
registers `RS256` or `ES256` gets a signed `/userinfo` response, and one that
registers `none` gets a JWT `/userinfo` response that is not signed — an RFC
7519 §6 unsecured JWT (`alg: "none"`, no signature). Both are `application/jwt`
and carry `iss` and `aud` (OIDC Core §5.3.2 for the "If signed" case; OIDC
Registration §2 and Discovery §3 for why `none` still serializes as a JWT at all
— see [the OIDC Core reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-core.md)).
Registration refuses a value the _tenant's own_ active signing key cannot
produce, and discovery's `userinfo_signing_alg_values_supported` is that same
tenant's answer — `[key.alg, "none"]` — never a fixed pair advertised to every
tenant regardless of which key it actually holds (a tenant holds exactly one).
`userinfo_encrypted_response_alg` and `_enc` are stored, echoed and now read too
— see [Encrypted and nested UserInfo
responses](./path-a-authorization-code-with-pkce.md#encrypted-and-nested-userinfo-responses)
below for the transcript.

The metadata checks below are shown anonymously, so the policy goes back to
`open` first — under `token` every one of them would answer the `401` above
before any metadata was read, and would demonstrate the credential rather
than the check:

```bash
odudu seed tenant --name reg-demo --set client_registration_policy=open
```

```json
{
  "command": "tenant",
  "created": false,
  "tenant": "reg-demo",
  "tenantId": "01a0cb08-2747-…",
  "settings": ["client_registration_policy"]
}
```

A non-HTTP `redirect_uri` has to look like RFC 8252 §7.1's reverse-DNS
custom scheme (ADR 0032): the scheme names at least one `.`, which is what
tells `com.example.app:/cb` apart from `javascript:`, `data:` and `file:`
without an enumerable denylist of dangerous ones. A dotless custom scheme —
common in the wild, and otherwise harmless — is refused all the same:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["myapp://cb"]}'
```

```json
{
  "error": "invalid_redirect_uri",
  "error_description": "redirect_uris entry myapp://cb is not valid"
}
```

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["com.example.app:/cb"]}'
```

```json
{
  "client_id": "01a0cb08-2e42-…",
  "client_id_issued_at": 1790112706,
  "client_secret": "of3NqFMwFsEOjqcvz46q-L18sz4EwP2Cge7LtyRRr8A",
  "client_secret_expires_at": 0,
  "redirect_uris": ["com.example.app:/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

A client holds at most 200 redirect URIs, the bound every list on a client
shares ([the admin paths](../admin-paths/patch-clientsid.md)); a longer list is
refused with the count and the limit, and 200 exactly is registered. In the
tenant `client-reach-demo`, with registration opened:

```bash
curl -sS -X POST http://localhost:3082/tenants/client-reach-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d @reg-over.json
```

`reg-over.json` held 201 URIs, `https://rp.example/cb/0` to `…/cb/200`:

```
{"error":"invalid_redirect_uri","error_description":"redirect_uris holds 201 entries, at most 200"}
```

`frontchannel_logout_uri` gets the same https/absolute/no-fragment policy
`backchannel_logout_uri` already had — it is the `src` of an iframe the
logout page now renders
([front-channel and back-channel logout](./rp-initiated-logout.md#front-channel-and-back-channel-logout)),
the sink a bare `http:` or `javascript:` value would otherwise reach:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"http://rp.example/fc"}'
```

```json
{
  "error": "invalid_client_metadata",
  "error_description": "frontchannel_logout_uri must be an absolute https URI with no fragment"
}
```

Front-Channel Logout 1.0 §2 also requires a registered `frontchannel_logout_uri`'s
domain, port and scheme to match one of the client's own `redirect_uris` —
an unauthenticated inbound surface is only as trustworthy as an origin the
client already proved it controls. Matching any one of several registered
redirect URIs satisfies it; a client with none registered has nothing to
match against and is refused the same way:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"https://evil.example/fc"}'
```

```json
{
  "error": "invalid_client_metadata",
  "error_description": "frontchannel_logout_uri must share its domain, port and scheme with a registered redirect_uri"
}
```

`frontchannel_logout_session_required` is accepted alongside it, stored and
echoed back the same way `backchannel_logout_session_required` already is,
defaulting to `false`:

```bash
curl -sS -X POST http://localhost:3000/tenants/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"https://rp.example/fc","frontchannel_logout_session_required":true}'
```

```json
{
  "client_id": "01a0cb08-2e9a-…",
  "client_id_issued_at": 1790112706,
  "client_secret": "cznVu4B8j-I63JVMDPbEUePpMSyV8EvDiwhOD0HR7Pk",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "frontchannel_logout_uri": "https://rp.example/fc",
  "frontchannel_logout_session_required": true
}
```

A registered `jwks` carries public keys only. A key holding any private member —
`d`, `p`, `q`, `dp`, `dq`, `qi` or `k` — is refused, on registration here and on
`POST` and `PATCH /admin/tenants/{tenant}/clients` alike, since all three
validate through the same client metadata check: a stored private half would be
handed back by every read and export of the client. These three calls are from a
different stack, published on port 3080, in a tenant `jwks-demo` created through
`POST /admin/tenants` with `client_registration_policy` set to `open` through
`PATCH /settings`, so the refusal is the key's and not the policy's. A private
key is refused by registration and by the admin API, and the first key without
its private member then registers:

```bash
curl -sS -X POST http://localhost:3080/tenants/jwks-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"token_endpoint_auth_method":"private_key_jwt","jwks":{"keys":[{"kty":"EC","crv":"P-256","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0","d":"jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI"}]}}'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"client_id":"signer-app","grant_types":["client_credentials"],"token_endpoint_auth_method":"private_key_jwt","jwks":{"keys":[{"kty":"oct","k":"c3ltbWV0cmljLXNlY3JldA"}]}}' \
  http://localhost:3080/admin/tenants/jwks-demo/clients
curl -sS -X POST http://localhost:3080/tenants/jwks-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"token_endpoint_auth_method":"private_key_jwt","jwks":{"keys":[{"kty":"EC","crv":"P-256","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}]}}'
```

```
{"error":"invalid_client_metadata","error_description":"jwks.keys[0] carries the private member d; register public keys only"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"jwks.keys[0] carries the private member k; register public keys only","errors":[{"path":"jwks","message":"jwks.keys[0] carries the private member k; register public keys only"}],"instance":"01a0ea63-bbfe-7bcd-9234-5a96705e5f51"}
{"client_id":"01a0ea63-bc2e-76fa-b646-56b5121f644e","client_id_issued_at":1790638799,"client_secret":"_YZPORl5uy3NcYXEzMq8PSjdCnddn4XutbW7T4-QR4Y","client_secret_expires_at":0,"redirect_uris":["https://rp.example/cb"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"private_key_jwt","jwks":{"keys":[{"kty":"EC","crv":"P-256","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}]}}
```

### The `mcp` policy

A fourth value of `client_registration_policy`, `mcp`, opens the endpoint to
one kind of client: an agent registering itself to reach the tenant's MCP
endpoint (ADR 0026's amendment). It is open in the way `open` is, with no
credential, and bounded in ways `open` is not. The client has to be public
(`token_endpoint_auth_method` of `none`, whose absence is refused rather than
defaulted to a secret), its redirect URIs `https` or `http` on a loopback host,
its grants `authorization_code` and `refresh_token`, no key set and no logout address, its `scope` at most
`mcp:read` beside the sign-in scopes, and its `audience`, when it names one,
exactly the tenant's MCP URL. A request is counted against ten an hour per
address on that tenant and sixty an hour for the tenant, and a tenant at its `max_clients` refuses as under any
policy. Neither `seed tenant --set` nor the admin API sets this value yet, so
the commands below set it in the database, on a tenant made for it:

```bash
odudu seed tenant --name mcp-demo
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "update tenants set client_registration_policy = 'mcp' where name = 'mcp-demo'"
```

```
{"command":"tenant","created":true,"tenant":"mcp-demo","tenantId":"01a1ad2c-bfc1-…"}
UPDATE 1
```

```bash
curl -sS -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb","http://127.0.0.1:53124/cb"],"token_endpoint_auth_method":"none","client_name":"Example Agent","scope":"openid mcp:read"}'
```

```json
{
  "client_id": "01a1ad2c-c0f1-…",
  "client_id_issued_at": 1793906753,
  "redirect_uris": ["https://agent.example/cb", "http://127.0.0.1:53124/cb"],
  "audience": ["http://localhost:3000/tenants/mcp-demo/mcp"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "none",
  "client_name": "Example Agent"
}
```

The row the registration wrote, and the one scope it was given beyond the
tenant's defaults. `mcp:read` is `optional`, so the client has to ask for it
and the person is shown it; `consent_required` is `true`, and `mcp:write` is
not assigned to any client the policy creates:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select c.type, c.registration_origin, o.token_endpoint_auth_method, o.audiences, o.consent_required
  from clients c join client_oidc_config o on o.client_id = c.id
  where c.client_id = '01a1ad2c-c0f1-75cd-bb2a-dcaf7ce5a2ed'"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select s.name, a.assignment
  from client_scope_assignments a
  join client_scopes s on s.id = a.client_scope_id
  join clients c on c.id = a.client_id
  where c.client_id = '01a1ad2c-c0f1-75cd-bb2a-dcaf7ce5a2ed' and s.name like 'mcp:%'"
```

```
  type  | registration_origin | token_endpoint_auth_method |                  audiences                   | consent_required
--------+---------------------+----------------------------+----------------------------------------------+------------------
 public | anonymous           | none                       | {http://localhost:3000/tenants/mcp-demo/mcp} | t
(1 row)

   name   | assignment
----------+------------
 mcp:read | optional
(1 row)
```

Each refusal below is `400` and stores nothing. A client that would hold a
secret (the first request names no `token_endpoint_auth_method`, which RFC 7591
defaults to `client_secret_basic`), a plain-`http` redirect that is not on a
loopback host, `mcp:write`, and an audience that is not this tenant's MCP URL:

```bash
curl -sS -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"client_name":"Example Agent"}'
curl -sS -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["http://agent.example/cb"],"token_endpoint_auth_method":"none"}'
curl -sS -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"token_endpoint_auth_method":"none","scope":"mcp:read mcp:write"}'
curl -sS -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"token_endpoint_auth_method":"none","audience":"https://api.example"}'
```

```
{"error":"invalid_client_metadata","error_description":"token_endpoint_auth_method must be none: this tenant's registration policy admits public clients only"}
{"error":"invalid_redirect_uri","error_description":"redirect_uris entry http://agent.example/cb is not valid"}
{"error":"invalid_client_metadata","error_description":"scope mcp:write is not available under this tenant's registration policy"}
{"error":"invalid_client_metadata","error_description":"audience must be http://localhost:3000/tenants/mcp-demo/mcp and nothing else under this tenant's registration policy"}
```

The ceiling is the tenant's `max_clients`, here lowered to the number of
clients it holds, and the budget is the eleventh request from one address
inside an hour. Every request above was counted, refused ones too: one
registration, four refusals and the refusal at the ceiling make six, so the
four in the loop reach ten and the request after them is the `429`. A tenant
is also held to sixty an hour over every address together, which this run did
not reach. The `429` carries `retry-after` in seconds:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "update tenants set max_clients = (select count(*) from clients where tenant_id = tenants.id) where name = 'mcp-demo' returning max_clients"
curl -sS -i -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"token_endpoint_auth_method":"none"}' | grep -iE '^HTTP|^\{'
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "update tenants set max_clients = 200 where name = 'mcp-demo'"
for i in 1 2 3 4; do curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"token_endpoint_auth_method":"none"}'; done
curl -sS -i -X POST http://localhost:3000/tenants/mcp-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://agent.example/cb"],"token_endpoint_auth_method":"none"}' \
  | grep -iE '^HTTP|^retry-after|^\{'
```

```
 max_clients
-------------
           3
(1 row)

UPDATE 1
HTTP/1.1 403 Forbidden
{"error":"invalid_client_metadata","error_description":"this tenant has reached its client registration limit"}
UPDATE 1
201
201
201
201
HTTP/1.1 429 Too Many Requests
retry-after: 3600
{"error":"invalid_client_metadata","error_description":"too many registrations from this address; retry later"}
```

A client registered this way, and a client whose `client_id` is a metadata
document under this policy, is shown the consent screen on every sign-in until
the person approves that exact client; see [Consent and
audit](../../../concepts/consent-and-audit.mdx). The consent screen's markup is
unchanged, so no sign-in is re-run here.
