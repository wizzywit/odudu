---
title: 'Path D: token exchange'
description: "RFC 8693's grant runs against a tenant of its own, exdoc, so the clients this exercises — one registered for the grant, one registered for it but…"
---

# Path D: token exchange

RFC 8693's grant runs against a tenant of its own, `exdoc`, so the clients
this exercises — one registered for the grant, one registered for it but
not permitted to impersonate, and one not registered for it at all — do not
crowd `demo`'s. Three clients and two users:

```bash
odudu seed \
  --tenant exdoc --client exdoc-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed user --tenant exdoc --username bot --password correct-horse-battery-2

odudu seed client \
  --tenant exdoc --client-id exdoc-exchange --client-secret exdoc-exchange-secret \
  --redirect-uri http://localhost:8080/callback \
  --grant-type authorization_code --grant-type refresh_token \
  --grant-type urn:ietf:params:oauth:grant-type:token-exchange \
  --token-exchange-actor-from-other-client
odudu seed client \
  --tenant exdoc --client-id exdoc-exchange-restricted --client-secret exdoc-exchange-restricted-secret \
  --redirect-uri http://localhost:8080/callback \
  --grant-type authorization_code --grant-type refresh_token \
  --grant-type urn:ietf:params:oauth:grant-type:token-exchange
odudu seed client \
  --tenant exdoc --client-id exdoc-no-exchange --client-secret exdoc-no-exchange-secret \
  --redirect-uri http://localhost:8080/callback \
  --grant-type authorization_code --grant-type refresh_token
```

`exdoc-exchange` was given `--token-exchange-actor-from-other-client`
because the actor token below was issued to `exdoc-spa`, not to the client
that presents it; `exdoc-exchange-restricted` was not, and
[a later section](#an-actor-token-another-client-was-issued-and-a-public-client)
shows what that costs it. `seed client` has no `--audience` or impersonation flag (see [the roadmap](../../../roadmap.md#decided-against-and-why)), so `exdoc-exchange` and
`exdoc-exchange-restricted` both get an audience set directly, and only the
first gets `token_exchange_impersonation_allowed` flipped on:

`client_id` is unique only within a tenant, so both updates below are
scoped to `exdoc` by name, not by `client_id` alone:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET audiences = ARRAY['https://api.exdoc.example'], token_exchange_impersonation_allowed = true
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'exdoc-exchange'
      AND client_oidc_config.tenant_id = (SELECT id FROM tenants WHERE name = 'exdoc');

    UPDATE client_oidc_config
    SET audiences = ARRAY['https://api.exdoc.example']
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'exdoc-exchange-restricted'
      AND client_oidc_config.tenant_id = (SELECT id FROM tenants WHERE name = 'exdoc');
  "
```

Signing in as `ada` and, separately, as `bot` — the same PKCE flow as
[Path A](./path-a-authorization-code-with-pkce.md), against `exdoc-spa` in
`exdoc` rather than `demo-spa` in `demo`, once per user — leaves
`$SUBJECT_TOKEN` (ada's access token) and `$ACTOR_TOKEN` (bot's).

## A delegation, with `act` naming the actor

An `actor_token` alongside the `subject_token` delegates: the issued token
keeps the subject's own identity and adds who is acting for them.

```bash
curl -sS -u exdoc-exchange:exdoc-exchange-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode "actor_token=$ACTOR_TOKEN" \
  --data-urlencode 'actor_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode 'resource=https://api.exdoc.example' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 292,
  "scope": "openid",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token"
}
```

Decoded, never verified (payload only):

```
{
  "iss": "http://localhost:3000/tenants/exdoc",
  "sub": "01a0cee5-c812-…",
  "aud": ["https://api.exdoc.example", "http://localhost:3000/tenants/exdoc"],
  "client_id": "exdoc-exchange",
  "scope": "openid",
  "iat": 1790177628,
  "exp": 1790177920,
  "jti": "01a0cee6-d09f-7cce-9e66-e7458d2c9110",
  "sid": "01a0cee6-b3d6-…",
  "grant_id": "01a0cee6-d09f-7cce-9e66-e7448248e095",
  "act": { "sub": "01a0cee6-8ab8-…" }
}
```

`sub` is still ada's own subject id — `SUBJECT_TOKEN`'s — and `act.sub` is
bot's: the requesting client, `exdoc-exchange`, delegated to bot, and the
issued token says so rather than becoming a token for bot outright. `aud`
carries both the named resource and the tenant's own issuer, the same
narrowing `resource` applies at every other grant (see [above](./path-a-authorization-code-with-pkce.md#4-token)'s
own `resource` bullet). `jti` and `grant_id` are shown in full rather than
truncated, the same coincidence [step 4](./path-a-authorization-code-with-pkce.md#4-token) already names.

## Impersonation, gated by a column no flag sets

Omitting `actor_token` asks to impersonate the subject outright — the
issued token names no actor at all. That is the branch
`token_exchange_impersonation_allowed` gates, and the column is the only
thing distinguishing the client below that gets refused from the one that
does not:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT clients.client_id, client_oidc_config.token_exchange_impersonation_allowed
    FROM client_oidc_config JOIN clients ON clients.id = client_oidc_config.client_id
    WHERE clients.client_id IN ('exdoc-exchange', 'exdoc-exchange-restricted')
    ORDER BY clients.client_id;
  "
```

```
         client_id         | token_exchange_impersonation_allowed
---------------------------+--------------------------------------
 exdoc-exchange            | t
 exdoc-exchange-restricted | f
(2 rows)
```

`exdoc-exchange-restricted` is registered for the grant — the allowlist below is
a separate check, already satisfied — but is refused before its `subject_token`
is ever read, so a garbage `subject_token` refuses exactly the same way a live
one would (held by the test `ODUDU-TOKEN-EXCHANGE-ORACLE-01`). `x-request-id`,
`Date` and the keep-alive headers are omitted below, as elsewhere in this
document:

```bash
curl -sS -D - -u exdoc-exchange-restricted:exdoc-exchange-restricted-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"unauthorized_client","error_description":"This client may not use this grant type."}
```

The identical request against `exdoc-exchange` — the client the column
above shows permitted — succeeds, and the issued token carries no `act` at
all:

```bash
curl -sS -D - -u exdoc-exchange:exdoc-exchange-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"access_token":"eyJhbGciOiJSUzI1NiIs…","token_type":"Bearer","expires_in":291,"scope":"openid","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

## Requesting a refresh token back

`requested_token_type` picks the issued shape. Asking for a refresh token
is the one that surprises a reader used to the other three grants: the
opaque token still travels in the response's `access_token` member, per
§2.2.1, with `token_type` reading `N_A` rather than `Bearer` because the
issued credential is not one:

```bash
curl -sS -u exdoc-exchange:exdoc-exchange-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode 'requested_token_type=urn:ietf:params:oauth:token-type:refresh_token' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
{
  "access_token": "XeEBhyNc7bBbT3mpNxgf9…",
  "token_type": "N_A",
  "expires_in": 268,
  "scope": "openid",
  "issued_token_type": "urn:ietf:params:oauth:token-type:refresh_token"
}
```

## The allowlist refusing an unregistered grant

`exdoc-no-exchange` never named the grant at seed time:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT clients.client_id, client_oidc_config.grant_types
    FROM client_oidc_config JOIN clients ON clients.id = client_oidc_config.client_id
    WHERE clients.client_id = 'exdoc-no-exchange';
  "
```

```
     client_id     |            grant_types
-------------------+------------------------------------
 exdoc-no-exchange | {authorization_code,refresh_token}
(1 row)
```

```bash
curl -sS -D - -u exdoc-no-exchange:exdoc-no-exchange-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"unauthorized_client","error_description":"This client may not use this grant type."}
```

Byte-identical to the impersonation refusal above — both are
`unauthorized_client` with nothing else to tell them apart, which is why
each transcript above shows the column its own refusal turns on rather
than asserting which check fired.

## An actor token another client was issued, and a public client

Two limits on the grant, both off until an administrator turns them on. The
actor token above, `bot`'s, was issued to `exdoc-spa`. `exdoc-exchange-restricted`
holds the grant too, but was not told it may present another client's actor
token, so the same request from it is refused. It is answered as every other
refusal of an actor token is, `invalid_request` (RFC 8693 §2.2.2), and
recorded under its own reason:

```bash
curl -sS -D - -H 'x-request-id: actor-from-other-client' \
  -u exdoc-exchange-restricted:exdoc-exchange-restricted-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode "actor_token=$ACTOR_TOKEN" \
  --data-urlencode 'actor_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode 'resource=https://api.exdoc.example' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
x-request-id: actor-from-other-client
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 104
Date: Thu, 05 Nov 2026 20:55:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -x -P 'null=(null)' -c \
  "select e.action, e.outcome, c.client_id as actor_client, e.detail
     from audit_events e left join clients c on c.id = e.actor_client_id
    where e.request_id = 'actor-from-other-client';"
```

```
-[ RECORD 1 ]+----------------------------
action       | token.exchange
outcome      | refused
actor_client | exdoc-exchange-restricted
detail       | {"reason": "invalid_grant"}
```

A public client holds no secret, so `/token` cannot tell its caller from
anyone else holding its `client_id`. A public client registered for the grant,
`exdoc-public` here (`odudu seed client --tenant exdoc --client-id exdoc-public
--public --redirect-uri http://localhost:8080/callback --grant-type
authorization_code --grant-type
urn:ietf:params:oauth:grant-type:token-exchange`), is refused it outright,
before either token is read. `$PUBLIC_SUBJECT_TOKEN` and `$PUBLIC_ACTOR_TOKEN`
are `ada`'s and `bot`'s tokens from signing in through `exdoc-public`, so
nothing about the tokens is at fault:

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'client_id=exdoc-public' \
  --data-urlencode "subject_token=$PUBLIC_SUBJECT_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode "actor_token=$PUBLIC_ACTOR_TOKEN" \
  --data-urlencode 'actor_token_type=urn:ietf:params:oauth:token-type:access_token' \
  'http://localhost:3000/tenants/exdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1ad7d-e82f-7db1-bb7f-cd1ffec423bd
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 94
Date: Thu, 05 Nov 2026 20:54:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"unauthorized_client","error_description":"This client may not use this grant type."}
```

An administrator allows it with the client's `token_exchange_allowed_for_public`
field, in the admin API (the token is the one from
[Getting the token](../admin-paths/getting-the-token.md)), under `If-Match`
like any other change to a client. The response is the client with the field
on, so this block shows the response headers only:

```bash
curl -sS -D - -o /dev/null -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" \
  -H 'content-type: application/json' \
  -d '{"token_exchange_allowed_for_public":true}' \
  "http://localhost:3000/admin/tenants/exdoc/clients/$CLIENT_ID"
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ad7d-fe3b-702a-a19c-7f73ef86b86e
cache-control: no-store
etag: "cb08f285c73ebf6b4c845701bd0589cbce9b19b755d4485708238bc7bb9ac8c9"
content-type: application/json; charset=utf-8
content-length: 2134
Date: Thu, 05 Nov 2026 20:54:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The same request now succeeds, its actor token being `exdoc-public`'s own,
run a minute later. The token is shortened as everywhere else here:

```
HTTP/1.1 200 OK
x-request-id: 01a1ad7f-3c21-7069-aad0-224b6e6980c8
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1130
Date: Thu, 05 Nov 2026 20:55:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJSUzI1NiIsImtp…","token_type":"Bearer","expires_in":212,"scope":"openid","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

## A client disabled after a token was issued to it

Disabling a client is an admin API operation
([the admin paths](../admin-paths/index.md)), not something this document's
`odudu seed` walks through, but its effect on a token that is already live
is a fact about `/userinfo`, `/introspect` and this grant, so it belongs
here rather than there. A tenant of its own, `disableddoc`, with a public
client that can both sign a user in and be disabled, and a confidential
`disableddoc-reader` registered for the exchange grant — the resource
server that introspects and exchanges the public client's tokens, kept
enabled throughout so a refusal below can only be the disabled client's own
doing:

```bash
odudu seed \
  --tenant disableddoc --client disableddoc-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com

odudu seed client \
  --tenant disableddoc --client-id disableddoc-reader --client-secret disableddoc-reader-secret \
  --redirect-uri http://localhost:8080/callback \
  --grant-type authorization_code --grant-type urn:ietf:params:oauth:grant-type:token-exchange
```

The top-level `odudu seed` has no `--grant-type`, `--audience` or
impersonation flag at all (see [the roadmap](../../../roadmap.md#decided-against-and-why)),
so `disableddoc-spa` — created through it, not through `seed client` — gets
the exchange grant, `token_exchange_allowed_for_public` (a public client is
refused the grant without it, as the section before this one shows) and `https://api.disableddoc.example` named in its own
`audiences` directly, the same way an id_token self-exchange needs
`token_exchange_impersonation_allowed` on directly, too, since with no
`actor_token` it is impersonating itself. `disableddoc-reader` gets the
identical `audiences` entry, so it is entitled to introspect and exchange
what `disableddoc-spa` mints, and impersonation on for the same reason, the
way [the section above](#impersonation-gated-by-a-column-no-flag-sets) turns
it on for `exdoc-exchange`:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET audiences = ARRAY['https://api.disableddoc.example'],
        grant_types = array_append(grant_types, 'urn:ietf:params:oauth:grant-type:token-exchange'),
        token_exchange_impersonation_allowed = true,
        token_exchange_allowed_for_public = true
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'disableddoc-spa'
      AND client_oidc_config.tenant_id = (SELECT id FROM tenants WHERE name = 'disableddoc');

    UPDATE client_oidc_config
    SET audiences = ARRAY['https://api.disableddoc.example'],
        token_exchange_impersonation_allowed = true
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'disableddoc-reader'
      AND client_oidc_config.tenant_id = (SELECT id FROM tenants WHERE name = 'disableddoc');
  "
```

Signing in as `ada` — [Path A](./path-a-authorization-code-with-pkce.md)'s own
flow, against `disableddoc-spa` in `disableddoc`, `scope=openid
offline_access` and `resource=https://api.disableddoc.example` so the
minted `aud` includes what `disableddoc-reader` is registered under — gives
`$ACCESS_TOKEN`, `$REFRESH_TOKEN` and `$ID_TOKEN` from one grant and one
session. While the client is still enabled, all five calls this section is
about succeed. `/userinfo`:

```bash
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:3000/tenants/disableddoc/protocol/openid-connect/userinfo"
```

```
HTTP/1.1 200 OK
vary: Origin
content-type: application/json; charset=utf-8

{"sub":"01a0d45f-9986-77b6-835a-3913b7fc63b1"}
```

`/introspect`, called by `disableddoc-reader` rather than by
`disableddoc-spa` itself — a caller distinct from the client under test, the
same way the access-token and refresh-token exchanges below need one:

```bash
curl -sS -u disableddoc-reader:disableddoc-reader-secret \
  -X POST "http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```
{"active":true,"scope":"openid offline_access","client_id":"disableddoc-spa","sub":"01a0d45f-9986-77b6-835a-3913b7fc63b1","aud":["https://api.disableddoc.example","http://localhost:3000/tenants/disableddoc"],"token_type":"Bearer","exp":1790269746,"iat":1790269446}
```

The access token exchanged by `disableddoc-reader`:

```bash
curl -sS -D - -u disableddoc-reader:disableddoc-reader-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$ACCESS_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode 'resource=https://api.disableddoc.example' \
  'http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"access_token":"eyJhbGciOiJSUzI1NiIs…","token_type":"Bearer","expires_in":290,"scope":"openid offline_access","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

The refresh token exchanged the same way:

```bash
curl -sS -D - -u disableddoc-reader:disableddoc-reader-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$REFRESH_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:refresh_token' \
  --data-urlencode 'resource=https://api.disableddoc.example' \
  'http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"access_token":"eyJhbGciOiJSUzI1NiIs…","token_type":"Bearer","expires_in":300,"scope":"openid offline_access","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

And, since an `id_token`'s audience must name the requesting client (OIDC
Core §3.1.2.2), a self-exchange of `$ID_TOKEN` — `disableddoc-spa` is
public, so this reaches `/token` with no credential at all, naming only
`client_id` in the body, the way [Path A](./path-a-authorization-code-with-pkce.md)
redeems a code:

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'client_id=disableddoc-spa' \
  --data-urlencode "subject_token=$ID_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:id_token' \
  'http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"access_token":"eyJhbGciOiJSUzI1NiIs…","token_type":"Bearer","expires_in":290,"scope":"","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

Disabling `disableddoc-spa` — the precondition every refusal below depends
on, shown rather than asserted, since an unrelated refusal (a dead session,
a revoked grant) would read no differently:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE clients SET enabled = false WHERE client_id = 'disableddoc-spa'
      AND tenant_id = (SELECT id FROM tenants WHERE name = 'disableddoc');
    SELECT client_id, enabled FROM clients WHERE client_id = 'disableddoc-spa';
  "
```

```
UPDATE 1
    client_id    | enabled
-----------------+---------
 disableddoc-spa | f
(1 row)
```

None of `$ACCESS_TOKEN`, `$REFRESH_TOKEN`, `$ID_TOKEN` or the session
behind them changed — every grant is still live and the session is still
live. The identical five requests, unchanged, now all refuse. `/userinfo`:

```
HTTP/1.1 401 Unauthorized
vary: Origin
www-authenticate: Bearer realm="userinfo", error="invalid_token"
content-length: 0
```

`/introspect`:

```
{"active":false}
```

The access token exchange:

```
HTTP/1.1 400 Bad Request
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

the refresh token exchange, identically:

```bash
curl -sS -D - -u disableddoc-reader:disableddoc-reader-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$REFRESH_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:refresh_token' \
  --data-urlencode 'resource=https://api.disableddoc.example' \
  'http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

and the `id_token` self-exchange:

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'client_id=disableddoc-spa' \
  --data-urlencode "subject_token=$ID_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:id_token' \
  'http://localhost:3000/tenants/disableddoc/protocol/openid-connect/token'
```

```
HTTP/1.1 401 Unauthorized
vary: Origin
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_client","error_description":"Client authentication failed."}
```

An `id_token` names no grant to revoke — `resolveIdToken` returns `grantId:
null` — so exchanging one reads `clients.enabled` directly rather than through a
grant, the one branch a revoked-grant check could never have reached. This
transcript's last refusal cannot prove that read fired, though: an id_token's
audience must name the requesting client, which makes this necessarily a
self-exchange, and a disabled client can no longer authenticate at `/token` for
**any** grant — `verifyClientSecret` already refuses a disabled client's own
client_secret, private_key_jwt or tls_client_auth attempt, the same way [The
branches](./the-branches.md) below documents for every other grant, and
`invalid_client` above is that refusal, not `resolveIdToken`'s. An integration
test covers the id_token branch's own read directly, the way [the impersonation
refusal above](#impersonation-gated-by-a-column-no-flag-sets) covers
`unauthorized_client`'s own oracle: by calling `resolveExchangeToken` itself
rather than through the client-authentication gate in front of it.

## A subject disabled after a token was issued to it

The same five calls again, for the other half of the same question: disabling a
**subject** ends nothing it holds either — its grants, its session and its
client are all untouched — so each of `/userinfo`, `/introspect` and the
exchange grant reads the token's subject beside its client (`subjectIsEnabled`,
the same predicate the refresh grant and the admin API ask). On a stack of its
own, on port 3080, brought up from an empty volume. Its tenant `subjdoc` is set
up exactly as `disableddoc` is above, under its own names — `subjdoc-spa`,
`subjdoc-reader` with secret `subjdoc-reader-secret`, the audience
`https://api.subjdoc.example`, and `ada` — and `$ACCESS_TOKEN`, `$REFRESH_TOKEN`
and `$ID_TOKEN` come from one sign-in the same way. The `Date`, `Connection` and
`Keep-Alive` lines are left out of each header block, and each issued
`access_token` is cut after its first bytes.

While `ada` is enabled, all five succeed. `/userinfo`, `/introspect`, the
access-token exchange, the refresh-token exchange and the `id_token`
self-exchange, in that order:

```bash
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:3080/tenants/subjdoc/protocol/openid-connect/userinfo"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ed77-6862-70c5-a810-a69d1250e153
vary: Origin
content-type: application/json; charset=utf-8
content-length: 46

{"sub":"01a0ed76-cc3a-7f71-a4ac-2c62b3c966fc"}
```

```bash
curl -sS -u subjdoc-reader:subjdoc-reader-secret \
  -X POST "http://localhost:3080/tenants/subjdoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```
{"active":true,"scope":"openid offline_access","client_id":"subjdoc-spa","sub":"01a0ed76-cc3a-7f71-a4ac-2c62b3c966fc","aud":["https://api.subjdoc.example","http://localhost:3080/tenants/subjdoc"],"token_type":"Bearer","exp":1790690705,"iat":1790690405}
```

```bash
curl -sS -D - -u subjdoc-reader:subjdoc-reader-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$ACCESS_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode 'resource=https://api.subjdoc.example' \
  'http://localhost:3080/tenants/subjdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ed77-68f2-7692-b732-1bdd74b33fda
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1082

{"access_token":"eyJhbGciOiJSUzI1NiI…","token_type":"Bearer","expires_in":284,"scope":"openid offline_access","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

```bash
curl -sS -D - -u subjdoc-reader:subjdoc-reader-secret \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$REFRESH_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:refresh_token' \
  --data-urlencode 'resource=https://api.subjdoc.example' \
  'http://localhost:3080/tenants/subjdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ed77-6943-7205-a3ad-1c3345ce296f
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1082

{"access_token":"eyJhbGciOiJSUzI1NiI…","token_type":"Bearer","expires_in":300,"scope":"openid offline_access","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'client_id=subjdoc-spa' \
  --data-urlencode "subject_token=$ID_TOKEN" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:id_token' \
  'http://localhost:3080/tenants/subjdoc/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ed77-6980-7459-9d28-6a9447d257e4
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1029

{"access_token":"eyJhbGciOiJSUzI1NiI…","token_type":"Bearer","expires_in":284,"scope":"","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

Disabling `ada` — the precondition every refusal below depends on, shown
rather than asserted; `PATCH /admin/tenants/subjdoc/subjects/{id}` with
`{"enabled":false}` writes the same column:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE subjects SET disabled_at = now() WHERE id = '01a0ed76-cc3a-7f71-a4ac-2c62b3c966fc';
    SELECT s.id, u.username, s.disabled_at IS NOT NULL AS disabled FROM subjects s JOIN users u ON u.subject_id = s.id WHERE s.id = '01a0ed76-cc3a-7f71-a4ac-2c62b3c966fc';
  "
```

```
UPDATE 1
                  id                  | username | disabled
--------------------------------------+----------+----------
 01a0ed76-cc3a-7f71-a4ac-2c62b3c966fc | ada      | t
(1 row)
```

The client is still enabled, the grant still live and the session still
open. The identical five requests now refuse, each the way that door
already refuses a revoked grant: `/userinfo` with RFC 6750 §3.1's
`invalid_token`,

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a0ed77-6a0e-7eaa-b525-1ca619886b84
vary: Origin
www-authenticate: Bearer realm="userinfo", error="invalid_token"
content-length: 0
```

`/introspect` with RFC 7662 §2.2's bare `{"active":false}`,

```
{"active":false}
```

and each exchange with the `invalid_request` RFC 8693 §2.2.2 gives an
unacceptable `subject_token` — the access token,

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ed77-6a54-7a80-bcf5-e0c47d10c6bb
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 104

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

the refresh token,

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ed77-6a88-770c-90a3-bf9abb37c569
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 104

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

and the `id_token`, which, unlike the disabled-client case above, reaches
the resolver: `subjdoc-spa` still authenticates, so this refusal is the
subject check's own.

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ed77-6ab7-7f76-85b8-66552b24f99d
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 104

{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```
