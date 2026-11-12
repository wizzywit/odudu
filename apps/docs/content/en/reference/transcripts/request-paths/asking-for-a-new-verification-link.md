---
title: 'Asking for a new verification link'
description: 'A verification link that was used or has expired is asked for again from the page that refuses it, and every request gets the same answer.'
---

# Asking for a new verification link

A verification link works once and for the tenant's `verify_email_ttl_seconds`. The page that refuses a link that was used or has
expired now carries a button, _Send a new link_, and the button posts to
`POST /tenants/{tenant}/login-actions/resend-verification`. The form holds one field, `key`: the key of the link that was refused.
Whoever holds it received that mail, so the form names no address, and the server reads the address, and the client the first link
returned to, from the row the key names. This page runs it.

Three rules decide what the request does, and none of them shows in the answer. A new mail is queued only when the key names a
verification link, the address it was for still needs verifying (it is the person's current address and was never verified, or it is
the address the person asked to change to and has not been replaced), and the address has not had three mails of this kind in the
last hour in that tenant. Every other case, an unknown key, a key of another tenant, a link of another kind, a verified address, a
spent budget and a tenant that does not exist, gets the same page with the same status and the same bytes. The request leaves one
audit row, `email.verification_resent`, when it queued a mail, and the row holds no address.

Every command was run, in this order, on a compose stack built for this page (port `3000`, the throttles at `10000`, the schedules
off), on a database that began empty, with the mail relay of [the me API: changes](./the-me-api-changes.md), so the mailed link can be
read. The stack had served no tenant before this page. These helpers do what the blocks below need; `psqlc` runs a statement as the
database owner, which is how a link is made to expire without waiting for it:

```bash
dc() { docker compose -p odudu-p4f-i10 -f infra/docker/compose.yaml -f compose.mail.yaml "$@"; }
odudu() { dc exec -T odudu node dist/main.js "$@"; }
psqlc() { dc exec -T postgres psql -U odudu -d odudu -At -c "$1"; }
mail_to() { curl -sS localhost:8092/api/v1/messages | jq -c '.messages[] | {to: [.To[].Address], subject: .Subject}'; }
BASE=http://localhost:3000
URL=$BASE/tenants/verify-demo/login-actions
```

## A link that has not been used

`ada` has an address nobody has proved, and a verification mail is queued for it. The command queues the mail and returns; the
second command sends it:

```bash
odudu seed --tenant verify-demo --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com --send-verification-email
odudu send-mail
mail_to
```

```
{"created":true,"tenant":"verify-demo","tenantId":"01a1d14c-9f49-7fa7-8a92-67233bf81aeb","clientId":"demo-spa","userSubjectId":"01a1d14c-9fdf-77fb-bd86-496773c95a6a"}
{"ran":true,"sent":1,"failed":0}
{"to":["ada@example.com"],"subject":"Verify your verify-demo account"}
```

Opening the link changes nothing: a mail scanner or a link preview opens it before the person does. The page names the address and the
tenant, then asks for the button, and the address is still unverified and the link still unspent afterwards:

```bash
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '.messages[0].ID')
LINK=$(curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
KEY=${LINK#*key=}
curl -sS "$LINK" | sed -n '/<h1>/,/<\/form>/p'
psqlc "select u.email_verified, a.consumed_at is null as unspent from users u join action_tokens a on a.subject_id = u.subject_id join tenants t on t.id = u.tenant_id where t.name = 'verify-demo' and u.username = 'ada';"
```

```
<h1>Confirm your email address</h1>
<p>Email address: <bdi>ada@example.com</bdi></p>
<p>Account at <bdi>verify-demo</bdi></p>
<p>Press the button to confirm this address.</p>
<form method="post" action="/tenants/verify-demo/login-actions/action-token">
  <input type="hidden" name="key" value="bHyNJ25jNwk3RI7SSwzrDef1FtDvaL1gllZoJnSooS4">
  <button type="submit">Confirm my email</button>
</form>
f|t
```

## A link that has expired

The link is made to expire, and opened again. The page says it cannot be used, and its form is the button that asks for another:

```bash
psqlc "update action_tokens set expires_at = now() - interval '1 minute' where tenant_id = (select id from tenants where name = 'verify-demo');"
curl -sS -o refused.html -w '%{http_code}\n' "$LINK"
sed -n '/<h1>/,/<\/form>/p' refused.html
```

```
UPDATE 1
400
<h1>This link can&#39;t be used</h1>
<p>It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.</p>
<form method="post" action="/tenants/verify-demo/login-actions/resend-verification">
  <input type="hidden" name="key" value="bHyNJ25jNwk3RI7SSwzrDef1FtDvaL1gllZoJnSooS4">
  <button type="submit">Send a new link</button>
</form>
```

Pressing the button posts the key. The answer is a page that says what happens if the address needs verifying, and the response
checksum below is what every answer after it is compared with. The server queued a second mail, and `odudu send-mail` sent it:

```bash
curl -sS -D headers.txt -o ask.html -X POST --data-urlencode "key=$KEY" -H 'x-request-id: resend-ada' $URL/resend-verification
sed -n 1p headers.txt
sed -n '/<h1>/,/<\/p>/p' ask.html
cksum < ask.html
odudu send-mail
mail_to
```

```
HTTP/1.1 200 OK
<h1>Verification link requested</h1>
<p>If this address needs verifying, a new link is on its way.</p>
1381548721 892
{"ran":true,"sent":1,"failed":0}
{"to":["ada@example.com"],"subject":"Verify your verify-demo account"}
{"to":["ada@example.com"],"subject":"Verify your verify-demo account"}
```

The new link opens its page and the button on that page verifies the address. The link is spent by the press, not by the visit, and a
second press is refused:

```bash
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '.messages[0].ID')
LINK2=$(curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
KEY2=${LINK2#*key=}
curl -sS -o /dev/null -w '%{http_code}\n' "$LINK2"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST --data-urlencode "key=$KEY2" $URL/action-token
psqlc "select u.email_verified from users u join tenants t on t.id = u.tenant_id where t.name = 'verify-demo' and u.username = 'ada';"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST --data-urlencode "key=$KEY2" $URL/action-token
```

```
200
200
t
400
```

## The same answer for everything else

The first key, now that its address is verified, asks again; so does a key nothing holds, the key of the link that was just used, a
tenant that does not exist and a request with no `key` at all. Each answer is the page of the first request, byte for byte: the same
checksum and the same length, and no mail is sent (`"sent":0`):

```bash
for target in "$URL/resend-verification key=$KEY" "$URL/resend-verification key=never-issued" "$URL/resend-verification key=$KEY2" "$BASE/tenants/nobody/login-actions/resend-verification key=$KEY" "$URL/resend-verification other=1"; do
  set -- $target
  curl -sS -X POST --data-urlencode "$2" "$1" | cksum
done
odudu send-mail
```

```
1381548721 892
1381548721 892
1381548721 892
1381548721 892
1381548721 892
{"ran":true,"sent":0,"failed":0}
```

## Three an hour

The mail budget is per tenant and address, three an hour for this kind of mail, and separate from the budgets of the other kinds. The count is per server process, so a deployment with N replicas admits N times as many. In
a second tenant `grace` has an unverified address and a link that has expired. Four requests are four identical pages, and three
mails: the fourth was answered and not sent. The last line counts the messages the relay holds for `grace`, the one sent when she was seeded and the three:

```bash
odudu seed --tenant verify-budget --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user grace --password correct-horse-battery --email grace@example.com --send-verification-email
odudu send-mail
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '.messages[0].ID')
GKEY=$(curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | grep -o 'action-token?key=[^ ]*' | tr -d '\r'); GKEY=${GKEY#*key=}
psqlc "update action_tokens set expires_at = now() - interval '1 minute' where tenant_id = (select id from tenants where name = 'verify-budget');"
for i in 1 2 3 4; do
  curl -sS -X POST --data-urlencode "key=$GKEY" $BASE/tenants/verify-budget/login-actions/resend-verification | cksum
done
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '[.messages[] | select(.To[0].Address == "grace@example.com")] | length'
```

```
{"created":true,"tenant":"verify-budget","tenantId":"01a1d14c-a910-7f0d-93b2-f9060eda3e5c","clientId":"demo-spa","userSubjectId":"01a1d14c-aa34-7241-84f1-c8d52385e315"}
{"ran":true,"sent":1,"failed":0}
UPDATE 1
1381548721 892
1381548721 892
1381548721 892
1381548721 892
{"ran":true,"sent":3,"failed":0}
4
```

## The audit trail

Each request that queued a mail wrote one row, and the fourth request of the second tenant wrote none. The actor is empty, because the
caller proved nothing, and `detail` is empty: it holds no address and no key. The `request_id` of the first row is the header
`x-request-id` the request carried:

```bash
psqlc "select t.name, e.action, e.outcome, e.actor_subject_id is null as no_actor, e.detail, e.request_id from audit_events e join tenants t on t.id = e.tenant_id where e.action = 'email.verification_resent' order by t.name, e.occurred_at;"
```

```
verify-budget|email.verification_resent|allowed|t|{}|01a1d14c-ad1a-7a98-bcda-5d446b422a82
verify-budget|email.verification_resent|allowed|t|{}|01a1d14c-ad32-782e-a2ec-b2086fb1fd0d
verify-budget|email.verification_resent|allowed|t|{}|01a1d14c-ad45-7fa8-bca0-7674aaceba32
verify-demo|email.verification_resent|allowed|t|{}|resend-ada
```
