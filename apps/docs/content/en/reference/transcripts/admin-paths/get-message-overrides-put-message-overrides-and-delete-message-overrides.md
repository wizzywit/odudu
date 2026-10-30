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
  tenant import is held to the same rule. Markup in it is shown as text, never
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
x-request-id: 01a18731-e620-70ec-8403-94f9038c6bc4
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 16478
Date: Thu, 29 Oct 2026 10:25:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"kinds":["sign-in","consent","select-account","logout-confirm","authorize-error","email-unverified","logged-out"],"messages":70}
{"kinds":["registration","reset","verification","required-actions","notice"],"messages":92}
{"kinds":["totp-enrolment","passkey-enrolment","recovery-codes","update-password","required-action"],"messages":50}
{"key":"login.otp.title","en":"Enter your authentication code"}
{"key":"login.recoveryCode.title","en":"Enter a recovery code"}
{"key":"login.title","en":"Sign in"}
```

### Listing, setting and reading back

The commands below were captured before the preconditions above existed: a `PUT`
without `If-Match` or `If-None-Match: *`, and a `DELETE` without `If-Match`, are
now refused with `428`. This section is not yet run again on a live stack.

`locale` is required. A tenant with no override lists none:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides"
echo
```

```
HTTP/1.1 200 OK
x-request-id: 01a18731-e643-7fd3-9a88-8e0a0fd8064e
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 12
Date: Thu, 29 Oct 2026 10:25:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must have required property 'locale'","errors":[{"path":"locale","message":"must have required property 'locale'"}],"instance":"01a18731-e669-7ec3-be11-75cc58d861a1"}
```

Setting one answers the override, and the locale is stored spelled `fr`:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Connexion"}' $P/message-overrides/FR/login.title
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr"
echo
```

```
HTTP/1.1 200 OK
x-request-id: 01a18731-e675-756f-a77c-5ebdd5aab0ce
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 97
Date: Thu, 29 Oct 2026 10:25:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"locale":"fr","key":"login.title","message":"Connexion","updated_at":"2026-10-29T10:25:56.869Z"}
{"items":[{"locale":"fr","key":"login.title","message":"Connexion","updated_at":"2026-10-29T10:25:56.869Z"}]}
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
7:<title>Connexion</title>
16:<h1>Connexion</h1>
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
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Bonjour"}' $P/message-overrides/fr/login.nonesuch
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Bonjour {"}' $P/message-overrides/fr/login.title
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"{nope} demande un accès"}' $P/message-overrides/fr/consent.heading
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"key: is not the key of any page message","errors":[{"path":"key","message":"is not the key of any page message"}],"instance":"01a18731-e6e5-7cc1-957d-720c85a4cecd"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"message: is not a valid message: check its braces and plural arms","errors":[{"path":"message","message":"is not a valid message: check its braces and plural arms"}],"instance":"01a18731-e6fe-7be5-bfba-f9ac36c429d4"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"message: uses {nope}, which the page does not supply; the page supplies {client}","errors":[{"path":"message","message":"uses {nope}, which the page does not supply; the page supplies {client}"}],"instance":"01a18731-e716-7b88-9539-3624363ddc2d"}
```

Markup in a message is not refused. It is stored as written and the page shows it
as text, with the tags escaped:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
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

Removing an override is `204`, and the message is the catalogue's again. Removing
one that is not there is `404`:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/message-overrides/fr/login.title
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/message-overrides/fr/login.title
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/message-overrides?locale=fr" | jq -c '.items[] | {key, message}'
```

```
HTTP/1.1 204 No Content
x-request-id: 01a18731-e774-7d9c-a852-e15921dfc98d
cache-control: no-store
Date: Thu, 29 Oct 2026 10:25:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

404
```
