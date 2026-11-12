---
title: "A subject's sessions: list and end one"
description: 'Both require manage-sessions; there is no view-sessions, the same reasoning that leaves clients with no view-clients — a session is reached only by…'
---

# A subject's sessions: list and end one

This page covers `GET /subjects/:id/sessions` and `DELETE /subjects/:id/sessions/:sid`.

Both require `manage-sessions`; there is no `view-sessions`, the same
reasoning that leaves clients with no `view-clients` — a session is reached
only by an operator who can also end one.

`GET` lists the subject's **live** sessions — the same liveness arithmetic
every other session consumer applies, each session measured against the
idle window its own `remembered` column picks. This is the one read keyed
on the subject rather than on a browser's cookie, so it is also the one
place an operator can see a session the cookie no longer names — a second
concurrent login can orphan one, and a remembered orphan idles for
`remember_me_idle_seconds` before it stops appearing (ADR 0033's
amendment). Each entry carries `id`, `created_at`, `last_active_at`,
`remembered`, `client_ids` — the OAuth `client_id` of every enabled
client the session holds a grant for — and `device`, an opaque id shared by
the sessions opened on one browser, `null` for one opened before it was
recorded. The blocks on this page were captured before `device` existed;
[A session's device](../request-paths/the-me-api.md#a-sessions-device) runs it. Paginated the same way every other
list in this API is: `?limit=` and `?cursor=`, a `Link: rel="next"` header
and a body `next` while more remain, ordered by `id` — a subject's sessions
are bounded per browser by `max_sessions_per_browser`, but unbounded across
however many browsers hold one, so this listing pages exactly like the
others rather than trusting that bound.

`DELETE` ends one session through the same call the RP-Initiated Logout usecase
makes (`endSession`) — there is one path that ends a session, not two. It
revokes every grant the session holds and enqueues a Back-Channel Logout Token
for each registered client that used it and has a `backchannel_logout_uri`
configured (§2.5 of the spec). **Front-Channel Logout does not apply here**: §3
renders an iframe per relying party in the End-User's own browser, and an
admin-initiated end has no browser to render one in, so only the back-channel
delivery is attempted. Beside its own `admin_mutation` row, `session.end`, it
writes the `session.ended` row every session end writes, with `detail.via`
`admin` ([request
paths](../request-paths/rp-initiated-logout.md#what-a-session-leaves-in-the-audit-log)).
A second `DELETE` of the same session is idempotent and answers `204`: ending an
already-ended session moves neither stamp, and a repeat delivery for the same
client is deduped by `backchannel_logout_deliveries_dedupe`. `expires_at` moves
only while it is still ahead of now, and `coalesce(revoked_at, now)` keeps the
first revocation — a bare assignment would push both stamps forward on every
repeat, so a second `DELETE` at a later moment would delay the reaping the first
one started rather than changing nothing. The repeat writes its own
`admin_mutation` row, since it is a request an administrator made, but no second
`session.ended`. An unknown session id, or one belonging to a different subject,
answers `404`.

A session needs a login, and a subject this API created has no password, so
this section runs against `bob` — seeded with
`seed user --tenant demo --username bob --password …`, subject
`01a0d6fd-ede7-704b-8d83-fa3801d427a0` — signing in through `demo-app`, a
public `authorization_code` client created for it. **`verify_email` was set
back to `false` first**: `PATCH /settings` above had turned it on, and with
it on the login ends on "Can't sign in yet" rather than in a session.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions
```

```
{"items":[{"id":"01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb","created_at":"2026-09-25T05:16:45.837Z","last_active_at":"2026-09-25T05:16:45.837Z","remembered":false,"client_ids":["demo-app"]}]}
```

`DELETE` twice over the same id, then the listing again — `204` both times,
and nothing left:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions/01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions/01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9df1-760b-8e13-7763f4c28a3d
cache-control: no-store
Date: Tue, 27 Oct 2026 01:32:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9e09-7004-9844-b3c1b3abb219
cache-control: no-store
Date: Tue, 27 Oct 2026 01:32:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```
