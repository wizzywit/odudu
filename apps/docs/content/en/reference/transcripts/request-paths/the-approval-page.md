---
title: 'The approval page'
description: 'Where a person answers a CIBA request: what the page shows, what refuses a decision, why a stranger sees nothing, and why a client cannot decide.'
---

# The approval page

`GET /tenants/{tenant}/approval/{id}` and `POST /tenants/{tenant}/approval/{id}` are the one place a CIBA request is
answered. The link in the mail carries only the approval's id. The page is for the signed-in person the approval belongs to:
it shows the client that asks, what it asks for and the client's own words, `binding_message`, and approves or denies with
a form that carries a token tied to the person's session and to this approval. It is a themeable page kind of its own,
`approval`. This page continues [CIBA: `bc-authorize` and the token poll](./ciba-bc-authorize-and-the-token-poll.md) on
the same stack and in the same shell, so its helpers (`bc`, `signin`, `decide`, `approval_id`) and its two people, `grace`
and `ada`, are those.

## A request, and the page without a session

Grace's agent asks again. Opened with no session at all, the page sends the browser through sign-in and back, and shows nothing of the request:

```bash
bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode 'binding_message=Tidy the demo roles' | tail -1; echo
APPROVAL=$(approval_id); echo "$APPROVAL"
curl -sS -i "$TENANT/approval/$APPROVAL" | sed -n '1p;/^[Ll]ocation/p'
```

```
{"auth_req_id":"MSEw9Cycxo8cx0DxodMC1--hyKrxKXqO8ms9gutHVBo","expires_in":600,"interval":5}
01a2130c-fc03-7094-8a3d-c2099f701d14
HTTP/1.1 302 Found
location: http://localhost:3200/console/auth/login?tenant=demo&return_to=%2Ftenants%2Fdemo%2Fapproval%2F01a2130c-fc03-7094-8a3d-c2099f701d14
```

## The page, with Grace's session

`signin` leaves Grace's session in `$JAR`. The page, with its headers (the policy is the one every server page has), names the client, what it asks, the words it sent, and when the request stops being valid.

```bash
signin grace my-agent
curl -sS -i -b "$JAR" "$TENANT/approval/$APPROVAL"
```

```
HTTP/1.1 200 OK
x-request-id: 01a2130c-fd13-7d41-a1ab-327502763581
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1584
Date: Wed, 25 Nov 2026 14:12:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Approve or deny a request</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1><bdi>My agent</bdi> is asking for your approval</h1>
<p class="context"><bdi>My agent</bdi> asks to sign in as you with: <bdi>openid</bdi></p>
<p class="context">It says: <bdi>Tidy the demo roles</bdi></p>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<p>Decide before 2026-11-25 14:22 UTC. After that the request is no longer valid.</p>
<p>Approve only if you started this request. If you do not recognize it, deny it.</p>
<form method="post" action="/tenants/demo/approval/01a2130c-fc03-7094-8a3d-c2099f701d14">
  <input type="hidden" name="csrf" value="CZzE_nAy-r0UZbwrUHPn_ovWOjQ_-9lF1JrIzkXOWfI">
  <button type="submit" name="decision" value="approve">Approve</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
</main>
</body>
</html>
```

`binding_message` is the client's text, so the page escapes it. A request whose message is markup is shown as text:

```bash
bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode 'binding_message=<img src=x onerror=alert(1)>' | tail -1; echo
OTHER=$(approval_id)
curl -sS -b "$JAR" "$TENANT/approval/$OTHER" | grep 'It says'
```

```
{"auth_req_id":"SaslBVZprbM8l2s79gBPf2gbVFTKhdw_Yehy7KxngsQ","expires_in":600,"interval":5}
<p class="context">It says: <bdi>&lt;img src=x onerror=alert(1)&gt;</bdi></p>
```

## What refuses a decision

The form's token is tied to the session and to the approval. A token that is wrong, the token of another approval, and a body with no token are each refused, and the approval stays pending:

```bash
TOKEN_OF_OTHER=$(curl -sS -b "$JAR" "$TENANT/approval/$OTHER" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p')
for body in "csrf=wrong&decision=approve" "csrf=$TOKEN_OF_OTHER&decision=approve" "decision=approve"; do
  curl -sS -o /dev/null -w '%{http_code}\n' -b "$JAR" --data "$body" "$TENANT/approval/$APPROVAL"
done
curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=pending" | jq -c '.items[] | {id, state}' | grep "$APPROVAL"
```

```
403
403
403
{"id":"01a2130c-fc03-7094-8a3d-c2099f701d14","state":"pending"}
```

## Somebody else, and nothing at all

Anything that is not the signed-in owner's pending approval gets one `404` page: an id that does not exist, an id that is not
an id, and another person's approval. Ada signs in and opens Grace's; the three bodies are the same bytes, so a link says
nothing about other people's approvals:

```bash
signin ada my-agent; ADA_JAR=$JAR; signin grace my-agent
for id in "$APPROVAL" 00000000-0000-4000-8000-000000000000 not-an-id; do
  BODY=$(mktemp); printf '%s ' "$id"; curl -sS -o "$BODY" -w '%{http_code} ' -b "$ADA_JAR" "$TENANT/approval/$id"; openssl md5 < "$BODY"
done
```

```
01a2130c-fc03-7094-8a3d-c2099f701d14 404 MD5(stdin)= 9903456aaa82ffd4044d4f8fca3ff28a
00000000-0000-4000-8000-000000000000 404 MD5(stdin)= 9903456aaa82ffd4044d4f8fca3ff28a
not-an-id 404 MD5(stdin)= 9903456aaa82ffd4044d4f8fca3ff28a
```

The page itself:

```bash
curl -sS -b "$ADA_JAR" "$TENANT/approval/$APPROVAL" | grep -E '<h1>|<p>'
```

```
<h1>This request is not available</h1>
<p>The link may be wrong or out of date, or the request may already be answered. Nothing was changed.</p>
```

## The client cannot decide

No credential a client holds reaches the decision. The agent's own secret, sent to the page, is no session, and a request carrying it is sent to sign-in like a visit by nobody:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -u "my-agent:$AGENT_SECRET" --data-urlencode decision=approve "$TENANT/approval/$APPROVAL"
curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=pending" | jq -c '.items[] | {id, state}' | grep "$APPROVAL"
```

```
302
{"id":"01a2130c-fc03-7094-8a3d-c2099f701d14","state":"pending"}
```

## The decision, once

Grace approves. The page answers, and the approval is `approved`, decided through the page. A second decision finds an approval that is no longer pending and gets the same `404` page as a stranger:

```bash
PAGE=$(curl -sS -b "$JAR" "$TENANT/approval/$APPROVAL"); TOKEN=$(printf '%s' "$PAGE" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p')
curl -sS -i -b "$JAR" --data-urlencode "csrf=$TOKEN" --data-urlencode decision=approve "$TENANT/approval/$APPROVAL" | sed -n '1p;/<h1/,/<\/p>/p'
curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=approved" | jq -c '.items[] | {id, state, decided_via}' | grep "$APPROVAL"
curl -sS -i -b "$JAR" --data-urlencode "csrf=$TOKEN" --data-urlencode decision=deny "$TENANT/approval/$APPROVAL" | sed -n '1p;/<h1/,/<\/p>/p'
```

```
HTTP/1.1 200 OK
<h1>Request approved</h1>
<p>The application can now continue. You can close this page.</p>
{"id":"01a2130c-fc03-7094-8a3d-c2099f701d14","state":"approved","decided_via":"ciba_page"}
HTTP/1.1 404 Not Found
<h1>This request is not available</h1>
<p>The link may be wrong or out of date, or the request may already be answered. Nothing was changed.</p>
```
