---
title: 'Retention: what odudu reap removes'
description: 'Everything above leaves rows behind, and nothing in any repository deletes one.'
---

# Retention: what `odudu reap` removes

Everything above leaves rows behind, and nothing in any repository deletes
one. `odudu reap` is the pass that does, on a stated window per table
([ADR 0021](https://github.com/wizzywit/odudu/blob/main/docs/adr/0021-retention-is-bounded-by-the-detection-window.md)).

**The counts in this section are the whole point of it, so they were captured
against a stack driven only as far as [Path
A](./path-a-authorization-code-with-pkce.md) plus one refresh rotation** — a
freshly built compose stack, `demo` seeded as [Bootstrap](./bootstrap.md) seeds
it, one login, one code redeemed, one refresh rotated, and nothing else.
Following this document end to end instead leaves dozens of sessions and grants
behind, and a pass over those reports numbers that say nothing about which rule
kept which row. Every report below is from such a stack, once the pass reported
`cleared` too, brought up from an empty volume with `ODUDU_REAP_ENABLED=false`
so that no pass but these ran. Run against that minimal stack, the pass removes
nothing at all:

```bash
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

Those zeros are the point. By this stage the database holds a consumed
authorization code, a used refresh token and an expired authentication
session — every one of them past its own `expires_at`, and every one of
them still required. The consumed code is what the replay two sections up
revoked a grant through; the used refresh token is what told reuse from an
unknown token. A pass keyed on expiry would have taken all three and left
both replays answering `invalid_grant` with nothing revoked behind them.

`email_outbox` and `backchannel_logout_deliveries` are the two tables here
with two windows of their own, and the same two windows for the same
reason. A delivered message is bounded from its delivery
(`ODUDU_RETENTION_EMAIL_SENT_SECONDS`, a week). One that never arrived has
no failure timestamp to bound it from — a spent attempt budget
(`ODUDU_OUTBOX_MAX_ATTEMPTS`) is the only durable record that it will never
be attempted again — so it is kept for `ODUDU_RETENTION_EMAIL_FAILED_SECONDS`
(thirty days) measured from the last attempt, which is how long an operator
has to read it. A message still inside its retry schedule, and one never
attempted at all, are not this pass's business at any age.

A back-channel logout delivery is bounded from its own delivery the same
way (`ODUDU_RETENTION_LOGOUT_DELIVERED_SECONDS`, a week), and one that
spent every attempt (`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS`, fixed at 5, with no
environment variable of its own) is kept for
`ODUDU_RETENTION_LOGOUT_FAILED_SECONDS` (thirty days) measured from the
last attempt. A delivery still inside its retry schedule is not this
pass's business at any age either.

`client_registration_tokens` is on the same footing as `action_tokens`: a
spent or expired one carries no detection value — a replayed unknown token
and a replayed spent one are refused identically — so
`ODUDU_RETENTION_REGISTRATION_TOKEN_SECONDS` (a week, like
`ODUDU_RETENTION_ACTION_TOKEN_SECONDS`) is a courtesy window for an operator
to read, not a bound ADR 0021's detection-window argument requires.

`tenant_issuer_retirements`, `client_metadata_cache`, `cimd_clients`, `dynamic_clients` and `tenant_domains` report `0` in every count
until the last section of the walkthrough, which registers a custom domain and
switches a tenant's address. The first has no window of its own: a retired
issuer is deleted once its `expires_at` has passed, since nothing accepts it
after that. `client_metadata_cache` holds the Client ID Metadata Documents the
server fetched for a tenant, and is emptied of the rows whose cache lifetime has
ended; it stays empty here because nothing in this walkthrough fetches one.
`cimd_clients` is the clients kept from those documents: one nobody has resolved for
thirty days is deleted, unless it holds a refresh token that can still be used, and it
comes back the next time its address is used. It stays empty here for the same reason.
`dynamic_clients` is the public clients that registered themselves (`registration_origin`
`anonymous`): one older than a week that nobody approved, no grant was ever made to, and
no live code belongs to is deleted, and a disabled one stays. It stays empty here as well,
until the section after the domains below.
`tenant_domains` deletes only a `pending` row older than
`ODUDU_RETENTION_PENDING_DOMAIN_SECONDS` (a week), a domain whose ownership
nobody proved. A `verified` or `failed` row is never deleted by this pass,
however old.

`audit_events` reports `0` in every count below, in both passes. The rows
this walkthrough writes there, one per login step, are minutes old, and
`audit_events`' own retention rule (`audit_retention_days`, 90 by default
and unrelated to any window above) deletes nothing younger than a day. The
forty-day backdate below does not touch that table.

What makes a row deletable is the **grant family** being past retention,
which is seven days for a session-bound family and thirty for an offline
one. Backdating the stack by forty days is the fastest way to see a pass
with work to do:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c "
UPDATE authentication_sessions SET created_at = created_at - interval '40 days', expires_at = expires_at - interval '40 days', consumed_at = consumed_at - interval '40 days';
UPDATE authorization_codes SET auth_time = auth_time - interval '40 days', expires_at = expires_at - interval '40 days', consumed_at = consumed_at - interval '40 days';
UPDATE token_grants SET created_at = created_at - interval '40 days';
UPDATE refresh_tokens SET issued_at = issued_at - interval '40 days', expires_at = expires_at - interval '40 days', used_at = used_at - interval '40 days';
UPDATE sessions SET created_at = created_at - interval '40 days', expires_at = expires_at - interval '40 days', last_active_at = last_active_at - interval '40 days';
"
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":2,"authorization_codes":1,"token_grants":1,"authentication_sessions":1,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":1,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

Both refresh tokens of the family, the code that produced it, the grant
itself, the authentication session the login consumed, and the SSO session.
The counts are the pass's own: `refresh_tokens` reports 2 rather than 0
because the pass deletes them itself rather than leaving them to the
`ON DELETE CASCADE` from `token_grants`, and the SSO session goes only after
the last grant referencing it — a session with a live grant is refused outright, because
nulling `token_grants.session_id` would promote a session-bound grant to an
offline one.

A second run has nothing left:

```bash
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

`console_sessions` and `console_logins` report `0` in every capture in this
section so far, because nothing in this walkthrough signs in to the admin
console. To see their rules work, insert rows directly into the same
stack, right after the second run above: three console sessions for `ada`
(idle for 31 minutes, past its own `expires_at`, and live) and two pending
logins (expired, and live):

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c "
INSERT INTO console_sessions (id, tenant_id, subject_id, secret_hash, access_token_wrapped, refresh_token_wrapped, id_token_wrapped, access_expires_at, created_at, last_seen_at, expires_at)
SELECT gen_random_uuid(), u.tenant_id, u.subject_id, sha256(gen_random_uuid()::text::bytea), 'a', 'r', 'i', now(), now() - s.age, now() - s.idle, now() + s.remaining
  FROM users u JOIN tenants t ON t.id = u.tenant_id,
       (VALUES (interval '1 hour', interval '31 minutes', interval '11 hours'),
               (interval '13 hours', interval '1 minute', interval '-1 hour'),
               (interval '1 hour', interval '1 minute', interval '11 hours')) AS s(age, idle, remaining)
 WHERE t.name = 'demo' AND u.username = 'ada';
INSERT INTO console_logins (id, tenant_id, state_hash, verifier_wrapped, nonce, return_to, expires_at)
SELECT gen_random_uuid(), t.id, sha256(gen_random_uuid()::text::bytea), 'v', 'n', '/console/', now() + l.remaining
  FROM tenants t, (VALUES (interval '-1 minute'), (interval '5 minutes')) AS l(remaining)
 WHERE t.name = 'demo';
"
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":2,"console_logins":1,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

The idle session and the expired one are removed, and so is the expired login.
The live session and the live login remain. A console session ends after thirty
minutes idle or at its own `expires_at`, whichever comes first. A pending login
ends at its `expires_at`. Neither table keeps a row past that point, because a
row past either bound cannot be used again, so keeping it would serve no
detection. The pass revokes no grant with the row: a console session's grant is
bound to the tenant's SSO session, and its refresh token answers `invalid_grant`
once that session idles out. The gateway itself revokes the grant when a request
finds the session over.

`pending_registrations` holds a registration waiting for its mailed link, one row per
address. A row is deleted when its link is opened, so only the ones nobody opened are
left, and they are kept for `ODUDU_RETENTION_ACTION_TOKEN_SECONDS` past their
`expires_at` (a week, a courtesy window and not a detection bound). To see the rule
work, add two to the same stack, one expired eight days ago and one still live:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c "
INSERT INTO pending_registrations (id, tenant_id, token_hash, username, email, password_hash, expires_at)
SELECT gen_random_uuid(), t.id, md5(p.name), p.name, p.name || '@example.com', 'h', now() + p.remaining
  FROM tenants t, (VALUES ('expired', interval '-8 days'), ('live', interval '1 hour')) AS p(name, remaining)
 WHERE t.name = 'demo';
"
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":1,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

The expired request is gone and the live one remains.

`tenant_domains` and `tenant_issuer_retirements` are the two tables a custom
domain adds. To see both rules work, give `demo` two domains and switch it to
one of them: `old.acme-corp.dev` is registered and never proved, so it stays
`pending`, and `login.acme-corp.dev` is made verified and the tenant's address,
which records the path address `demo` left as a retired issuer for an hour. The
`--assume-verified` flag exists for this and refuses to run in production:

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host old.acme-corp.dev
docker compose exec -T odudu odudu seed domain --tenant demo --host login.acme-corp.dev --assume-verified --canonical
odudu reap
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1ad1a-6166-7f58-9cce-6bff2c6322a7","host":"old.acme-corp.dev","state":"pending","canonical":false,"created":true,"recordName":"_odudu-challenge.old.acme-corp.dev","recordValue":"odudu-domain-verification=XYrQ46Q0JQkha8pT71r7SF3G7BaCtXWXiuWdQNy92Co"}
{"command":"domain","tenant":"demo","tenantId":"01a1ad1a-6166-7f58-9cce-6bff2c6322a7","host":"login.acme-corp.dev","state":"verified","canonical":true,"created":true}
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
```

Nothing is due: the pending row is a minute old and the retired issuer is inside
its hour. Backdating the registration by eight days and ending the retirement
makes both due:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c "update tenant_domains set created_at = created_at - interval '8 days' where state = 'pending'; update tenant_issuer_retirements set expires_at = now() - interval '1 minute';"
odudu reap
docker compose exec -T postgres psql -U odudu -d odudu -c "select host, state, canonical from tenant_domains;"
```

```
UPDATE 1
UPDATE 1
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":1,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":0,"tenant_domains":1,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
        host         |  state   | canonical
---------------------+----------+-----------
 login.acme-corp.dev | verified | t
(1 row)
```

The unproved domain and the expired retirement are gone. The verified domain,
which is the tenant's address, stays however old it is.

`dynamic_clients` is what keeps a tenant that lets clients register themselves from
filling with ones nobody used. On a separate tenant, `dyn-demo`, seeded as `demo` is (a client, and `ada`), with registration open,
two public clients registered and a person approved one of them (a consent row, written
here directly); both were then backdated by eight days. The unused one is deleted and the
approved one stays:

```bash
odudu seed tenant --name dyn-demo --set client_registration_policy=open
curl -sS -X POST http://localhost:3000/tenants/dyn-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/unused"],"token_endpoint_auth_method":"none","client_name":"unused"}'
curl -sS -X POST http://localhost:3000/tenants/dyn-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/approved"],"token_endpoint_auth_method":"none","client_name":"approved"}'
docker compose exec -T postgres psql -U odudu -d odudu -c "insert into consents (id, tenant_id, subject_id, client_id) select gen_random_uuid(), c.tenant_id, u.subject_id, c.id from clients c join users u on u.tenant_id = c.tenant_id where c.name = 'approved' and u.username = 'ada'; update clients set created_at = created_at - interval '8 days' where registration_origin = 'anonymous';"
odudu reap
docker compose exec -T postgres psql -U odudu -d odudu -c "select name, registration_origin, type from clients where registration_origin = 'anonymous' order by name;"
```

```
INSERT 0 1
UPDATE 2
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"pending_registrations":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"console_sessions":0,"console_logins":0,"tenant_issuer_retirements":0,"client_metadata_cache":0,"cimd_clients":0,"dynamic_clients":1,"tenant_domains":0,"sessions":0,"audit_events":0},"cleared":{"client_previous_secrets":0}}
   name   | registration_origin |  type
----------+---------------------+--------
 approved | anonymous           | public
(1 row)
```

## When the pass refuses, or finds nothing to look at

Three answers are not a report of rows, and each says which it is. Before any
tenant exists there is nothing to enumerate, and the pass says so rather than
reporting a clean sweep of zeros — on a stack that had been migrated and not yet
seeded, so it is the one command in this document that answers differently once
[Bootstrap](./bootstrap.md) has been followed:

```bash
odudu reap
```

```
{"ran":false,"reason":"no tenant was enumerated"}
```

That is an outcome, not an error: it exits 0, the way a lost lock does.
`reap` also **refuses to run at all** in two configurations, exiting
non-zero, because in both the row-level-security policy that scopes its
deletes would be inert:

- The variable is unset. The compose stack sets it, so seeing this takes
  taking it back off the command's own environment — `env -u`, rather than
  `-e ODUDU_APP_DATABASE_URL=`, which is a different refusal: an empty
  string is an unparseable URL and the configuration schema rejects it
  before this check is reached.

```bash
docker compose exec -T odudu env -u ODUDU_APP_DATABASE_URL node dist/main.js reap
```

```
reap requires ODUDU_APP_DATABASE_URL: its deletes run under the tenant policy, which the owner role the migrations use escapes
```

The server's own boot guard demands it only in production; this command
demands it always, because there is no deployment where reaping with the
policy switched off is the intention. The schedule inside the server is
the one place that does not refuse per attempt: outside production it
declines to start at all, warning
`not reaping: ODUDU_APP_DATABASE_URL is unset` once, rather than throwing
this every hour for the life of the process.

- The serving connection's role is a `SUPERUSER` or holds `BYPASSRLS`, so the
  policy does not apply to it. Pointing `ODUDU_APP_DATABASE_URL` at the owner
  is the way to reach it:

```bash
docker compose exec -e ODUDU_APP_DATABASE_URL=postgres://odudu:odudu@postgres:5432/odudu \
  -T odudu node dist/main.js reap
```

```
reap deletes under the tenant policy, so its serving connection must be subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role
```

And symmetrically, `reap must list tenants on a connection that bypasses
row-level security; ODUDU_DATABASE_URL names a role that is neither
SUPERUSER nor BYPASSRLS` — the tenants to visit are read on the owner
connection, `tenants` carries `FORCE ROW LEVEL SECURITY`, and a listing role
without the escape reads none of them. Checked against `pg_roles` rather
than guessed at from an empty result, which is the same fact arriving too
late to act on.

The server also runs this pass itself, every `ODUDU_REAP_INTERVAL_SECONDS`
(default `3600`) plus up to a tenth of that as jitter, which is why the counts
above are reproducible only if the backdating and the command follow each other
inside one interval. `ODUDU_REAP_ENABLED=false` switches the schedule off for a
deployment that runs the command on its own timetable ([ADR
0024](https://github.com/wizzywit/odudu/blob/main/docs/adr/0024-a-scheduled-pass-is-a-command-first.md))
— and, the compose file passes that variable through: `ODUDU_REAP_ENABLED=false
docker compose up -d` left it out of the container's environment entirely and
the schedule ran anyway. The first tick is one interval away rather than
immediate, which is why the counts above survived that gap.

Running it from more than one place at once is safe, whether the other
place is a cron entry or another replica's own schedule: the pass takes a
Postgres advisory lock for the whole tick, and whoever finds it held does
nothing rather than duplicating the work. Holding the same key from a psql
session is enough to see it:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c \
  'begin; select pg_advisory_xact_lock(20260915); select pg_sleep(12); commit;' &
sleep 3
odudu reap
```

```
{"ran":false,"reason":"another instance holds the retention lock"}
```

A skipped pass is reported as a skipped pass, not as a report of zeros: a
scheduled job that conflated the two would claim success for work nobody
did.
