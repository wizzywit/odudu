---
title: 'Message overrides: list, set, remove'
description: 'A tenant’s own wording for the messages its pages and its mail show, per language. manage-tenant.'
---

# Message overrides: list, set, remove

This page covers `GET /message-catalogue`, `GET /message-overrides`, `PUT /message-overrides/{locale}/{key}` and `DELETE /message-overrides/{locale}/{key}`.

All four need `manage-tenant`. They change the words a page or a mail shows; which
languages a tenant offers, and which one it prefers to the browser's, are the
`supported_locales` and `default_locale` settings (see [GET /settings and PATCH
/settings](./get-settings-and-patch-settings.md)).

- `GET /message-catalogue` lists the messages the pages and the mail are filled from, so a
  template's `{{t "key"}}` and an override's `key` can be chosen rather than
  guessed. It answers `sections`, one per package that fills pages and a last one for the
  mail, each with the `kinds` it fills (none for the mail) and its `messages` as `key` and `en`, the English text, in key
  order. A template of a kind may name only a key of its own section; an override
  may name the key of any, a mail's included. It is the same for every tenant, read from the build
  and not the database, a few hundred messages and well under 100 KB, and so
  is never paged. The mail section leaves out the attribution a mail carries
  (`mail.brand`, `mail.copyright`, `mail.poweredBy`), which a page has no
  counterpart for.
- `GET /message-overrides?locale=fr` lists one locale's overrides in key order,
  each with its `locale`, `key`, `message` and `updated_at`. `locale` is
  required and must be a language tag such as `fr` or `zh-Hant-TW`. It pages
  with `limit` (at most 200) and `cursor`, so a tenant's 500 overrides are never
  read at once; a cursor from another locale is refused with `400`. Each item
  also carries its `etag`, the version of that override.
- `PUT /message-overrides/{locale}/{key}` with `{"message": "…"}` sets the text a
  page or mail shows for the message `key`, such as `login.title` or
  `reset.subject`, in `locale`, and
  answers the override. `key` must name a message of a page or of a mail, else `400` with the
  field `key`; the message is 1 to 2,000 characters, must be valid message
  syntax (an unbalanced brace is a `400` on `message`) and holds no
  bidirectional control characters. It may use the placeholders the English
  catalogue message of the same key uses, and no others: one the page does not
  supply is a `400` on `message` naming it and what the page does supply, since
  the page would otherwise show the catalogue's text with nothing to say why. A
  tenant import is held to the same rule. The text for `consent.heading` must also use `{client}`, so a consent page always names the application asking; a text without it is a `400` on `message`. Markup in it is shown as text, never
  rendered. The
  locale is stored spelled `fr-CA`, whatever was typed.
- Two administrators editing the same key cannot overwrite one another unseen.
  Changing an override takes `If-Match` with the `etag` read from the list (or
  from the answer to the last `PUT`, which carries it as its `ETag` header);
  creating one takes `If-None-Match: *`; removing one takes `If-Match`. A request
  with neither header, or with `*` as `If-Match`, is refused with `428`; a stale
  `If-Match`, a replace of a key that has since been removed, and a create of a
  key that now exists, with `412`. Overrides of different keys never conflict.
- A tenant holds at most 500 overrides across every locale. The 501st is
  refused with `409` (`about:blank#message-overrides-full`); changing one that
  exists is always allowed, and two simultaneous writes cannot both take the last
  place.
- `DELETE /message-overrides/{locale}/{key}` answers `204`, or `404` when there is
  none, and the page shows the catalogue's text again.

A tenant may offer a language through overrides alone: its pages then render
with `lang` set to that tag and English text for every key it has not
overridden, since the catalogue holds no other text for it.

A mail is in the language the pages would negotiate for its recipient: the
recipient's own `locale`, else the tenant's `default_locale`, among the
languages the tenant offers, else English. It is worded from the overrides of
that language, read in the transaction the mail is queued in, so a write
reaches mail queued after it and never one already queued. A client has no
overrides of its own: a mail is worded by the tenant's.

A write takes effect on the next page this process renders; another replica shows
the previous text for at most 30 seconds, the lifetime of its cache. Each write
is audited as `message_override.set` or `message_override.delete` with the locale
and key and, for a set, the length of the text and never the text.

## The messages, and a tenant's own wording

Everything below ran in one session against a freshly built stack, in a tenant
`override-demo` created for this page, holding a public client `portal` and no
override. `$ADMIN_TOKEN` is `ada`'s token from [Getting the token](./getting-the-token.md):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"override-demo","display_name":"Override Demo"}' \
  http://localhost:3000/admin/tenants | jq -c '{name, display_name, enabled}'
```

```
{"name":"override-demo","display_name":"Override Demo","enabled":true}
```

```bash
P=http://localhost:3000/admin/tenants/override-demo
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{client_id, type}'
```

```
{"client_id":"portal","type":"public"}
```

### The catalogue

The catalogue is the same for every tenant. It is read from the build and never
paged: the headers and its size, then each section's page kinds and how many
messages it holds, then the entries for the sign-in page's own title:

```bash
curl -sS -D - -o catalogue.json -H "Authorization: Bearer $ADMIN_TOKEN" $P/message-catalogue
jq -c '.sections[] | {kinds, messages: (.messages | length)}' catalogue.json
jq -c '.sections[].messages[] | select(.key | startswith("login.")) | select(.key | test("title|heading"))' catalogue.json
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b59-9b0e-74e9-abc5-a5c39b2946eb
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 21830
Date: Fri, 30 Oct 2026 05:47:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"kinds":["sign-in","consent","select-account","logout-confirm","authorize-error","email-unverified","logged-out"],"messages":70}
{"kinds":["registration","reset","verification","required-actions","notice"],"messages":92}
{"kinds":["totp-enrolment","passkey-enrolment","recovery-codes","update-password","required-action"],"messages":50}
{"kinds":[],"messages":62}
{"key":"login.otp.title","en":"Enter your authentication code"}
{"key":"login.recoveryCode.title","en":"Enter a recovery code"}
{"key":"login.title","en":"Sign in"}
```

### Listing, setting and reading back

`locale` is required. A tenant with no override lists none:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides"
echo
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b59-9b45-7d46-b714-0462efe9969c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 12
Date: Fri, 30 Oct 2026 05:47:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must have required property 'locale'","errors":[{"path":"locale","message":"must have required property 'locale'"}],"instance":"01a18b59-9bd1-751d-b7df-aba262c42e30"}
```

Creating an override takes `If-None-Match: *`, and a `PUT` that sends neither
precondition is refused with `428` before anything is written. With it the answer is
the override, with its `ETag` as a header and as `etag` in the body, and the locale is
stored spelled `fr`:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Connexion"}' $P/message-overrides/FR/login.title
echo
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-None-Match: *' \
  -d '{"message":"Connexion"}' $P/message-overrides/FR/login.title
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr"
echo
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a18b59-9be3-745e-93b6-9a83df9db221
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 220
Date: Fri, 30 Oct 2026 05:47:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a message override (or send If-None-Match: * to create one)","instance":"01a18b59-9be3-745e-93b6-9a83df9db221"}
HTTP/1.1 200 OK
x-request-id: 01a18b59-9c45-751f-8b7c-bcdcab318d7c
cache-control: no-store
etag: "4cd2aae063c6903268ffbe05e2274ffa87204bd66dd2bc575c725b258b28b8d9"
content-type: application/json; charset=utf-8
content-length: 175
Date: Fri, 30 Oct 2026 05:47:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"locale":"fr","key":"login.title","message":"Connexion","updated_at":"2026-10-30T05:47:48.182Z","etag":"\"4cd2aae063c6903268ffbe05e2274ffa87204bd66dd2bc575c725b258b28b8d9\""}
{"items":[{"locale":"fr","key":"login.title","message":"Connexion","updated_at":"2026-10-30T05:47:48.182Z","etag":"\"4cd2aae063c6903268ffbe05e2274ffa87204bd66dd2bc575c725b258b28b8d9\""}]}
```

Changing it takes the `etag` read from the list, as `If-Match`. A stale one is `412`, a
create of a key that now exists is `412`, and `*` as `If-Match` is `428`; none of them
changes the override, and the right one does, with a new `ETag`:

```bash
ETAG=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -r '.items[0].etag')
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-Match: "0000"' \
  -d '{"message":"Connexion au portail"}' $P/message-overrides/fr/login.title
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-None-Match: *' \
  -d '{"message":"Connexion au portail"}' $P/message-overrides/fr/login.title
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-Match: *' \
  -d '{"message":"Connexion au portail"}' $P/message-overrides/fr/login.title
echo
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"message":"Connexion au portail"}' $P/message-overrides/fr/login.title
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -c '.items[] | {key, message}'
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a18b59-9d4e-7add-9b5b-173787dd47e0"}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-None-Match: * was sent, but the message override already exists","instance":"01a18b59-9e00-7b63-8304-d2597a653d9d"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match must name a version you read; * is not accepted when replacing a message override (or send If-None-Match: * to create one)","instance":"01a18b59-9e38-71f0-8b6c-f8f2112535a0"}
HTTP/1.1 200 OK
x-request-id: 01a18b59-9ea4-7085-92e7-362eebd30370
cache-control: no-store
etag: "84f6a6608eaf9c1837a8fe6928deca609fc7909c23b77010d3faf4ac1f31520b"
content-type: application/json; charset=utf-8
content-length: 186
Date: Fri, 30 Oct 2026 05:47:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"locale":"fr","key":"login.title","message":"Connexion au portail","updated_at":"2026-10-30T05:47:48.816Z","etag":"\"84f6a6608eaf9c1837a8fe6928deca609fc7909c23b77010d3faf4ac1f31520b\""}
{"key":"login.title","message":"Connexion au portail"}
```

The language is then offered through the tenant's settings, and the page it
shows follows. The sign-in page of the client, fetched with no `Accept-Language`
at all, names `fr` in its `<html>` and uses the override for its title and
heading, English for every key the tenant has not overridden:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"supported_locales":["fr"],"default_locale":"fr"}' \
  $P/settings | jq -c '{supported_locales, default_locale}'
curl -sS 'http://localhost:3000/tenants/override-demo/protocol/openid-connect/auth?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | grep -n -E '<html|<title>|<h1>|<label>|<button'
```

```
{"supported_locales":["fr"],"default_locale":"fr"}
2:<html lang="fr" dir="ltr">
7:<title>Connexion au portail</title>
16:<h1>Connexion au portail</h1>
22:  <label>Username <input type="text" name="username" autocomplete="username"></label>
23:  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
24:  <button type="submit">Sign in</button>
29:  <p><button type="submit" id="passkey-submit" class="secondary">Sign in with a passkey</button></p>
```

### What is refused

A key that names no message of a page, a message with an unbalanced brace, and a
placeholder the page does not supply (`consent.heading` is filled with `{client}`
and nothing else) are each `400`, with the field that is wrong:

```bash
ETAG=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -r '.items[] | select(.key == "login.title") | .etag')
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-None-Match: *' \
  -d '{"message":"Bonjour"}' $P/message-overrides/fr/login.nonesuch
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"message":"Bonjour {"}' $P/message-overrides/fr/login.title
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-None-Match: *' \
  -d '{"message":"{nope} demande un accès"}' $P/message-overrides/fr/consent.heading
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"key: is not the key of any page or mail message","errors":[{"path":"key","message":"is not the key of any page or mail message"}],"instance":"01a18b59-a05f-7e2a-867c-24f54dcd5948"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"message: is not a valid message: check its braces and plural arms","errors":[{"path":"message","message":"is not a valid message: check its braces and plural arms"}],"instance":"01a18b59-a0b1-770b-b81c-2b46b0a517c6"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"message: uses {nope}, which the page does not supply; the page supplies {client}","errors":[{"path":"message","message":"uses {nope}, which the page does not supply; the page supplies {client}"}],"instance":"01a18b59-a131-77f1-ba97-5a6ff01e32d7"}
```

Markup in a message is not refused. It is stored as written and the page shows it
as text, with the tags escaped:

```bash
ETAG=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -r '.items[] | select(.key == "login.title") | .etag')
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"message":"<b>Connexion</b>"}' $P/message-overrides/fr/login.title | jq -c '{key, message}'
curl -sS 'http://localhost:3000/tenants/override-demo/protocol/openid-connect/auth?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | grep -n -E '<title>|<h1>'
```

```
{"key":"login.title","message":"<b>Connexion</b>"}
7:<title>&lt;b&gt;Connexion&lt;/b&gt;</title>
16:<h1>&lt;b&gt;Connexion&lt;/b&gt;</h1>
```

### Removing one

Removing an override takes `If-Match` with its `etag` too: without one it is `428`, with
a stale one `412`, and with the right one `204`, after which the message is the
catalogue's again. Removing one that is not there is `404`:

```bash
ETAG=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -r '.items[] | select(.key == "login.title") | .etag')
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/message-overrides/fr/login.title
echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H 'If-Match: "0000"' $P/message-overrides/fr/login.title
echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" $P/message-overrides/fr/login.title
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" $P/message-overrides/fr/login.title
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -c '.items[] | {key, message}'
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a18b59-a396-7e26-b928-190fd31fc5a5
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 189
Date: Fri, 30 Oct 2026 05:47:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace or remove a message override","instance":"01a18b59-a396-7e26-b928-190fd31fc5a5"}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a18b59-a3b5-7c58-917a-a48a6b6bbbc1"}
HTTP/1.1 204 No Content
x-request-id: 01a18b59-a3d5-7f94-bf8a-385efeb4e67c
cache-control: no-store
Date: Fri, 30 Oct 2026 05:47:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

404
```
