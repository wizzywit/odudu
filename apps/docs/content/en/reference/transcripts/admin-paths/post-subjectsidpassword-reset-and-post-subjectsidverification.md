---
title: 'Password reset and verification mail for a subject'
description: "Requires manage-users. Each queues a link to the subject's own address, minted and mailed by the same write the self-service door makes…"
---

# Password reset and verification mail for a subject

This page covers `POST /subjects/:id/password-reset` and `POST /subjects/:id/verification`.

Requires `manage-users`. Each queues a link to the subject's own address, minted
and mailed by the same write the self-service door makes (`enqueueResetLink` and
`enqueueVerificationLink`, `@odudu/account`), and answers `202` with no body:
the link is never in the response, nor in the audit row,
`subject.password_reset_send` or `subject.verification_send`, whose `detail` is
empty unless the request named a client. Each is held to the target ceiling like every other write under
`/subjects/:id`, and each is throttled per origin with the sign-in, registration
and reset-request submissions (ADR 0023; not shown here, since the budget was
raised for these runs — an integration test holds it). A subject with no `users`
row answers `404`. Each refusal a link would otherwise meet later, silently, is
a `409` of its own type:

- `about:blank#no-email` — the subject has no address;
- `about:blank#reset-password-off`, a reset only — the tenant's
  `reset_password_allowed` is off, so its reset page would refuse the link;
- `about:blank#no-mail-relay` — `GET /smtp` would answer `effective` `none`:
  the tenant has no relay and the deployment no sender, so the mail would
  only be logged.

None of the three writes a row: each is a conflict with the data, not a guard
(ADR 0037's amendment of 2026-09-28). For `grace` and then `linus`, who has no
address, taking each refusal in turn: the setting, then a relay for `ops-demo`
at the stack's own `postgres` container, port 25, where nothing listens:

```bash
G=01a109f6-6f97-7579-a5ed-5c486dcd23aa
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reset_password_allowed":true}' "$P/settings" | grep -o '"reset_password_allowed":[a-z]*'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/smtp"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"; echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"postgres","port":25,"from_address":"noreply@ops.example"}' "$P/smtp"; echo
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/verification"
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c748-743d-b60e-9b0ed48221a3/verification"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?resource_type=subject&resource_id=$G&action=subject.password_reset_send"; echo
```

```
{"type":"about:blank#reset-password-off","title":"Conflict","status":409,"detail":"reset_password_allowed is off, so the tenant would refuse the link; turn it on with PATCH /settings first","instance":"01a0ee8c-61e6-766b-9b7d-dfa1705a654d"}
"reset_password_allowed":true
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"type":"about:blank#no-mail-relay","title":"Conflict","status":409,"detail":"the tenant has no relay and the deployment no sender, so the mail would only be logged","instance":"01a0ee8c-6254-71bb-99ff-38173b7334d0"}
{"configured":true,"host":"postgres","port":25,"from_address":"noreply@ops.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
HTTP/1.1 202 Accepted
x-request-id: 01a0ee8c-6291-7ba8-91e6-d08ea702a515
cache-control: no-store
content-length: 0
Date: Tue, 29 Sep 2026 19:02:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72

202
{"type":"about:blank#no-email","title":"Conflict","status":409,"detail":"the subject has no email address to send to","instance":"01a0ee8c-62de-71e8-afbb-2a704e8fa724"}
{"items":[{"id":"01a0ee8c-62ab-7858-b95a-960db8f34277","occurred_at":"2026-09-29T19:02:52.832Z","event_type":"admin_mutation","action":"subject.password_reset_send","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","request_id":"01a0ee8c-6291-7ba8-91e6-d08ea702a515","ip":"172.22.0.1","detail":{}}]}
```

## Returning to a client

Each takes an optional body naming the client the link returns to: `client_id`,
the `client_id` of an enabled client of this tenant, and `redirect_uri`, one of
its registered redirect URIs, needed only when the client registers more than
one. The last page of the link then offers a "Return to the application" link to
that address with `action_status`, `success`, or `error` on the page of a link
that cannot be used, a hint that the "me" API's credential list confirms. A
client of another tenant, or a disabled one, is refused with `400`
`about:blank#return-client-unknown`, an address the client does not register with
`about:blank#return-redirect-uri-unregistered`, and none named where it registers
several with `about:blank#return-redirect-uri-required`, each queueing nothing;
the three are shown in [the actions link's section](./post-subjectsidactions-email.md),
whose body takes the same two members, and the audit row names the `client_id`.
A request with no body, which is every request these routes took before, mails
the link it always did, and its page ends with no link. A body that names any
other field is refused with `400`; before, these two routes ignored a body.

On a stack of its own, on `http://localhost:3141`, with the tenant
`required-actions-demo` of that page, its client `actions-app`, the other
tenant's `foreign-app` and a subject `heidi` with an address and no password
(`P=http://localhost:3141/admin/tenants/required-actions-demo`, `G` her id; the
ids and the request ids are this run's own), the reset setting on and a relay set
as there. A reset naming the other tenant's client, a verification and a reset naming
`actions-app`, then the two links read from the outbox and followed, each page
printed from its heading:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"client_id":"foreign-app"}' "$P/subjects/$G/password-reset"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"client_id":"actions-app"}' "$P/subjects/$G/verification" -o /dev/null -w '%{http_code}\n'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"client_id":"actions-app","redirect_uri":"https://app.example/callback"}' "$P/subjects/$G/password-reset" -o /dev/null -w '%{http_code}\n'
mailed() { docker compose -p odudu-p4f-i41 exec -T postgres psql -U odudu -d odudu -At -c \
  "select body_text from email_outbox where tenant_id = (select id from tenants where name = 'required-actions-demo') and to_address = 'heidi@example.test' and subject like '$1%' order by created_at desc limit 1;" \
  | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r'; }
V=$(mailed 'Verify'); R=$(mailed 'Reset')
curl -sS -X POST --data-urlencode "key=${V##*key=}" http://localhost:3141/tenants/required-actions-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
curl -sS -X POST --data-urlencode "key=${R##*key=}" --data-urlencode 'password=another long passphrase' \
  http://localhost:3141/tenants/required-actions-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
```

```
{"type":"about:blank#return-client-unknown","title":"Bad Request","status":400,"detail":"client_id names no enabled client of this tenant","instance":"01a1ccd9-7d8b-74ec-9827-36025f9c0022"}
202
202
<h1>Your email address is confirmed</h1>
<p>Return to the application you were signing in to and sign in again.</p>
<p class="links">
<a href="https://app.example/callback?action_status=success">Return to the application</a>
</p>
</main>
<h1>Your password has been reset</h1>
<p>Return to the application you were signing in to and sign in with your new password.</p>
<p class="links">
<a href="https://app.example/callback?action_status=success">Return to the application</a>
</p>
</main>
```

A verification with no body, followed the same way, ends as the page always did:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/verification" -o /dev/null -w '%{http_code}\n'
V=$(docker compose -p odudu-p4f-i41 exec -T postgres psql -U odudu -d odudu -At -c \
  "select body_text from email_outbox where tenant_id = (select id from tenants where name = 'required-actions-demo') and to_address = 'heidi@example.test' and subject like 'Verify%' order by created_at desc limit 1;" \
  | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
curl -sS -X POST --data-urlencode "key=${V##*key=}" http://localhost:3141/tenants/required-actions-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
```

```
202
<h1>Your email address is confirmed</h1>
<p>Return to the application you were signing in to and sign in again.</p>
</main>
```
