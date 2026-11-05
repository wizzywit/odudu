---
title: Read a refusal
description: 'What an error from Odudu looks like and why it happened: a wrong password, an unknown client, a reused token, too much scope, a stale update, a request sent twice.'
sidebar_position: 4
---

# Read a refusal

When Odudu says no, the answer has a shape that tells you who can act on it. A person at a sign-in page sees a short message. A client sees an OAuth error code. An admin tool sees a problem document with a status. Each refusal below says what you see, why it happens and what to do.

## 1. A wrong password

The sign-in form comes back with one message, whatever was wrong. A wrong password, a name nobody holds, a locked account and a disabled account all read the same, so the page cannot be used to find out which accounts exist.

```
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Sign-in failed. Check your details and try again.</li>
</ul>
</div>
```

What to do: nothing in your app. The person tries again.

Full transcript: [A refused login says so](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#a-refused-login-says-so).

## 2. A client or redirect Odudu cannot trust

If the client is unknown, or the redirect address does not match one registered, Odudu does not redirect at all. It shows the error on its own page, because sending the person to an address it cannot vouch for would make it an open redirector.

```
<h1>Can&#39;t continue</h1>
<p><bdi>Unknown or disabled client</bdi></p>
<p><small>invalid_client</small></p>
```

The redirect address must match a registered one exactly, as a string. A trailing slash, a different case or an added query all fail.

```
http://localhost:8080/callback           200
http://localhost:8080/callback/          400
http://localhost:8080/Callback           400
http://localhost:8080/callback?x=1       400
http://LOCALHOST:8080/callback           400
http://localhost:8080/callback#f         400
```

What to do: register the exact address on the client.

Full transcript: [The branches](../reference/transcripts/request-paths/the-branches.md).

## 3. A code or refresh token used twice

An authorization code works once, and a refresh token works once. A second use answers `invalid_grant`, and Odudu revokes what the first use produced, because a second use means a copy exists somewhere.

```
{"error":"invalid_grant","error_description":"The code or token is not valid."}
```

What to do: discard the tokens and send the person through sign-in again.

Full transcript: [Replaying an authorization code](../reference/transcripts/request-paths/path-b-refresh-rotation.md#replaying-an-authorization-code).

## 4. More scope than was granted

A refresh can ask for less than the grant holds, never more. Asking for more is refused with `invalid_scope`, and the token you sent is not used up, so your next honest request still works.

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$RT" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'scope=openid profile email admin' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

```
{
  "error": "invalid_scope",
  "error_description": "A requested scope is not available to this client."
}
```

What to do: ask for a scope the client is assigned.

Full transcript: [What a replay does not do](../reference/transcripts/request-paths/path-b-refresh-rotation.md#what-a-replay-does-not-do).

## 5. A wrong client secret

A confidential client that sends the wrong secret, or a client that does not exist, gets the same `401`. The answer does not say which.

```bash
curl -sS -w '\n%{http_code}\n' -H 'x-request-id: token-refused-wrong-secret' \
  -u demo-backend:wrong-secret --data-urlencode 'grant_type=client_credentials' \
  "$BASE/token"
```

```
{"error":"invalid_client","error_description":"Client authentication failed."}
401
```

What to do: check the client's id and secret.

Full transcript: [What a refused token request leaves in the audit log](../reference/transcripts/request-paths/path-b-refresh-rotation.md#what-a-refused-token-request-leaves-in-the-audit-log).

## 6. A change made on a stale copy

Admin updates carry the `ETag` of the version they were based on. If somebody changed the user in the meantime, the update is refused with `412` and nothing is written.

```
HTTP/1.1 412 Precondition Failed
x-request-id: 01a13ff3-3986-786b-8fac-4370a66c669f
content-type: application/problem+json; charset=utf-8
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a13ff3-3986-786b-8fac-4370a66c669f"}
```

What to do: read the user again and apply your change to the new version.

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 7. A request from another site

The console refuses a write that does not come from itself. A request with the wrong `Origin`, or without the console's header, gets `403` before anything else runs.

```
HTTP/1.1 403 Forbidden
```

```
{"status":403,"type":"about:blank","title":"Forbidden","detail":"refused as cross-site: origin-mismatch","instance":"01a13ff3-6c8f-75c8-8cd7-2e257c06a71f"}
```

What to do: send both `Origin` and `X-Odudu-Console: 1` from the console's own origin.

Full transcript: [POST …/subjects, refused as cross-site](../reference/transcripts/console-paths/post-consoleapiadmintenantstenantsubjects-refused-as-cross-site.md).

## 8. A request sent twice

A client that never hears an answer to a create cannot tell whether it arrived. Every admin `POST` takes an `Idempotency-Key`: the first call with a key runs, and a repeat is answered from the first without running again. This is the same command as the first call, sent a second time.

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f9c1c2e-6a0e-4b8a-9c1e-2d7b1e0a5f01" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3000/admin/tenants/idem-demo/roles
```

```
HTTP/1.1 201 Created
x-request-id: 01a1adf9-2c85-72a2-b327-682418d54851
cache-control: no-store
etag: "3d09ecc5d47b8ac57c8f0558a6970fdb6134e98a752311a818d0b3eb5c5c9780"
content-type: application/json; charset=utf-8
idempotent-replayed: true
content-length: 239
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adf9-2c73-7ce6-b8aa-37bf1c28cadd","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-05T23:09:10.639Z","admin_reach":[]}
```

The answer is the first call's, with `idempotent-replayed: true`, and one role and one audit row exist. Sending the same key with a different request is refused, and nothing is applied.

```
{"type":"about:blank#idempotency-key-reused","title":"Unprocessable Content","status":422,"detail":"this Idempotency-Key was used for a different request; use a new key for a new request","instance":"01a1adf9-2d7e-79a0-8d07-26c7bb15196f"}
```

What to do: use a new key for each new request, and the same key only to repeat one. A refusal or a failure is not kept, so a request that failed can be sent again with its key.

Full transcript: [Retrying a create with an Idempotency-Key](../reference/transcripts/admin-paths/get-roles-post-roles-get-rolesid-patch-rolesid-and-delete-rolesid.md#retrying-a-create-with-an-idempotency-key).

## Where to go next

- [Sign a user in](./sign-a-user-in.md) shows the flow these refusals come from.
- All error codes are listed in the [error reference](../reference/generated/errors.md).
