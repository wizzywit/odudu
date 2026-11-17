---
title: 'POST /subjects/:id/actions-email'
description: 'Requires manage-users. The body names the required actions the link takes the subject through — {"actions": […]}, at least one of update-password…'
---

# `POST /subjects/:id/actions-email`

Requires `manage-users`. The body names the required actions the link takes the
subject through — `{"actions": […]}`, at least one of `update-password`,
`configure-totp`, `configure-passkey` and `generate-recovery-codes`, the
vocabulary `PUT /subjects/:id/required-actions` takes, anything else refused
with `400`, as is any other field. The body can also name the client the link
returns to, `client_id` and `redirect_uri`, which the section below sets out. The
link is minted and mailed to the subject's own address by `enqueueActionsLink`
(`@odudu/account`), and the answer is `202` with no body. The two routes above
are the same core with a fixed link: one `sendAccountEmail` does the lookups,
the target ceiling, the three `409`s, the mail and the audit row for all three,
so they cannot drift.

**What the link does.** Opening it shows the actions, and consumes nothing,
so a mail scanner's `GET` does not spend it. Submitting it sets a new
password where `update-password` is named, under the reset link's rules — the
tenant's policy, the previous password refused, every outstanding
password-setting link retired — and owes every other action, so the subject's next sign-in parks on
each, as it does for one an administrator set. **The link alone never enrols
a factor**: possession of a mailbox stands in for a forgotten password, as a
reset link's does, but enrolling a TOTP secret or a passkey still takes a
sign-in with the password and whatever factor the subject already holds. The
link lives as long as a reset link (`reset_password_ttl_seconds`), since it
signs its subject in by their mailbox the same way, and it is spent once.

**Returning to a client.** The body may name `client_id`, the `client_id` of an
enabled client of this tenant, and `redirect_uri`, one of that client's
registered redirect URIs. The last page of the link then offers a "Return to
the application" link to that address with `action_status`, `success` once the
link is used, or `error` on the page of a link that cannot be used. It is a hint,
as the parameter is on `/authorize`: the "me" API's credential list is where the
outcome is read. The page links to the address and does not redirect to it,
because a registered callback reached without a `code` or `state` reads to a
client as a failed or forged response, and because the page also says what is
still owed. `redirect_uri` is optional for a client that registers exactly
one address and has to match a registered one exactly otherwise. The request is
refused with `400`, nothing mailed, when the client is another tenant's or is
disabled (`about:blank#return-client-unknown`), when `redirect_uri` is not
registered (`about:blank#return-redirect-uri-unregistered`), when the client
registers none or several and none is named
(`about:blank#return-redirect-uri-required`), and with a plain `400` when
`redirect_uri` comes without `client_id`. The link keeps the client's internal
id and the chosen address; when it is opened, the client's registration is read
again, and the page leaves the link out when the client was deleted or disabled
or no longer registers the address. A request with no `client_id` is as it was:
the page ends with no link, and the same holds for the two routes above.

The `409`s are the reset's: `about:blank#no-email`, `about:blank#no-mail-relay`,
and `about:blank#reset-password-off` when `update-password` is named while
the tenant's `reset_password_allowed` is off — its reset page would refuse
the link, and an outstanding link stops working the moment the setting is
turned off. It is held to the target ceiling and throttled per origin with
the sign-in, registration and reset submissions, as the two routes above
are. The link is never in the response, and the audit row,
`subject.actions_email_send`, names the actions, and the `client_id` when the
request named one, and nothing else.

In a tenant `required-actions-demo` made for it, with a relay at the stack's own
`postgres` container, port 25, where nothing listens, a client `actions-app`
registering `https://app.example/callback`, a client `two-uris` registering
`https://app.example/a` and `https://app.example/b`, `grace` made through
`POST /subjects` with an address and no password, and a second tenant
`foreign-demo` with a client `foreign-app`;
`P=http://localhost:3141/admin/tenants/required-actions-demo`. `grace`'s id and
the request ids are this run's own. A link asking for a password while the
tenant's reset is off, the setting turned on, a client of the other tenant, a
client with two addresses and none named, one that is not registered, an address
with no client, an action the server does not take, then the send naming
`actions-app`, which is accepted, and its audit row:

```bash
G=01a1ccd8-a24b-780d-a6ab-3b2ccc913695
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp","update-password"]}' "$P/subjects/$G/actions-email"; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reset_password_allowed":true}' "$P/settings" | grep -o '"reset_password_allowed":[a-z]*'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp"],"client_id":"foreign-app"}' "$P/subjects/$G/actions-email"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp"],"client_id":"two-uris"}' "$P/subjects/$G/actions-email"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp"],"client_id":"two-uris","redirect_uri":"https://app.example/else"}' \
  "$P/subjects/$G/actions-email"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp"],"redirect_uri":"https://app.example/callback"}' "$P/subjects/$G/actions-email"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["verify-email"]}' "$P/subjects/$G/actions-email"; echo
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp","update-password"],"client_id":"actions-app"}' "$P/subjects/$G/actions-email"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?resource_type=subject&resource_id=$G&action=subject.actions_email_send" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"type":"about:blank#reset-password-off","title":"Conflict","status":409,"detail":"reset_password_allowed is off, so the tenant would refuse the link; turn it on with PATCH /settings first","instance":"01a1ccd8-ec5f-73a8-a5dd-067f31387ed8"}
"reset_password_allowed":true
{"type":"about:blank#return-client-unknown","title":"Bad Request","status":400,"detail":"client_id names no enabled client of this tenant","instance":"01a1ccd8-ecb0-7737-a95f-76dae820c4a5"}
{"type":"about:blank#return-redirect-uri-required","title":"Bad Request","status":400,"detail":"the client does not register exactly one redirect_uri, so the request must name which","instance":"01a1ccd8-ecc7-73f8-bce5-934fbf50427d"}
{"type":"about:blank#return-redirect-uri-unregistered","title":"Bad Request","status":400,"detail":"redirect_uri is not one the client registers; it must match one exactly","instance":"01a1ccd8-ecde-702c-ae10-e5546e5cb199"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uri needs a client_id to belong to","instance":"01a1ccd8-ecf4-75ef-85bb-0a0cf361df7a"}
{"type":"about:blank","title":"Error","status":400,"detail":"body/actions/0 must be equal to one of the allowed values","errors":[{"path":"actions[0]","message":"must be equal to one of the allowed values"}],"instance":"01a1ccd8-ed05-707b-b6cd-8be13f5bf2a0"}
HTTP/1.1 202 Accepted
x-request-id: 01a1ccd8-ed17-7d82-9078-bc4ea422023f
cache-control: no-store
content-length: 0
Date: Wed, 11 Nov 2026 23:02:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"action":"subject.actions_email_send","outcome":"allowed","detail":{"actions":["update-password","configure-totp"],"client_id":"actions-app"}}
```

The mail was read from the tenant's outbox, and its link opened and then
submitted with a password, and submitted again. The first page is the one that
ends the link, with the way back to the registered address and `success`; the
second is the page of the spent link, which offers it with `error` beside the
request for a new link:

```bash
LINK=$(docker compose -p odudu-p4f-i41 exec -T postgres psql -U odudu -d odudu -At -c \
  "select body_text from email_outbox where tenant_id = (select id from tenants where name = 'required-actions-demo') order by created_at desc limit 1;" \
  | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
KEY=${LINK##*key=}
curl -sS -o /dev/null -w '%{http_code}\n' "$LINK"
curl -sS -X POST --data-urlencode "key=$KEY" --data-urlencode 'password=a much longer new passphrase' \
  http://localhost:3141/tenants/required-actions-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
curl -sS -X POST --data-urlencode "key=$KEY" --data-urlencode 'password=a much longer new passphrase' \
  http://localhost:3141/tenants/required-actions-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
```

```
200
<h1>Your account is updated</h1>
<p>Sign in to the application to finish:</p>
<ul>
<li>Set up an authenticator app</li>
</ul>
<p class="links">
<a href="https://app.example/callback?action_status=success">Return to the application</a>
</p>
</main>
<h1>This link can&#39;t be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>
<p class="links">
<a href="/tenants/required-actions-demo/login-actions/reset-password">Request a new link</a>
<a href="https://app.example/callback?action_status=error">Return to the application</a>
</p>
</main>
```

The mail and Mailpit's view of it that follow are from an earlier run than the one
above, whose mail has the same text. The one mail the tenant's outbox holds, read there, since the relay delivers nothing —
the actions in the order the link will ask for them, which is the one the
audit row lists too:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select subject, body_text from email_outbox where tenant_id = (select id from tenants where name = 'required-actions-demo');"
```

```
Update your required-actions-demo account|Your administrator asks you to update your ⁨required-actions-demo⁩ account:

- Choose a new password
- Set up an authenticator app

Do so by visiting this link:

http://localhost:3000/tenants/required-actions-demo/login-actions/action-token?key=4zSeBj8AeoVl6hBnud6z6BvOaY40VCaHkMzrcbde2bI

If you were not expecting this, you can ignore this message.

--
You received this because an administrator at ⁨required-actions-demo⁩ asked you to update your account.
© 2026 Odudu · Powered by odudu
```

The mail text is the mail package's catalogue, with the tenant name inside
Unicode isolates (U+2068 and U+2069, invisible here), and after the `--` line
the reason it was sent and the footer, whose year is that of the moment it was
queued. The block above is from a second run (tenant `required-actions-demo`,
`grace`, the same request), so its link is that run's, on `localhost:3000`
because the server there was told that was its public base URL, and names
nothing from the run above. Its relay was a Mailpit container, so the message
was delivered as well as queued, and Mailpit shows what arrived: the mark is an
inline image, which the SMTP sender attaches because the markup names it
`cid:odudu-mark` (`ID` is the message's id in Mailpit's list):

```bash
curl -s "http://localhost:18925/api/v1/message/$ID" | jq -c '{To: [.To[].Address], From: .From.Address, Subject, Inline: [.Inline[] | {FileName, ContentType, ContentID, Size}]}'
```

```
{"To":["grace@example.test"],"From":"odudu@actions.test","Subject":"Update your required-actions-demo account","Inline":[{"FileName":"odudu.png","ContentType":"image/png","ContentID":"odudu-mark","Size":893}]}
```

The same mail rendered through `renderRequiredActions` with these inputs gives
exactly the bytes of the block above.

What following it does is under [Following a required-actions link](../request-paths/following-a-required-actions-link.md).
