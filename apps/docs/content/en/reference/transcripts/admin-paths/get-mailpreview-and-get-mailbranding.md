---
title: 'GET /mail/preview and GET /mail/branding'
description: 'The verification mail as a tenant’s or a client’s published theme dresses it, and the logo and colours it inherits.'
---

# `GET /mail/preview` and `GET /mail/branding`

Both need `manage-tenant` and answer for the tenant in the path. A client's own are `GET /clients/:id/mail/preview` and `GET /clients/:id/mail/branding`, which need `manage-clients`, the capability a client's theme needs.

- `GET /mail/preview?kind=&scheme=&locale=` answers the address-verification
  mail as an HTML document, built by the code that builds the real one, with a
  sample address and link. It shows the tenant's published theme, never a draft,
  and a tenant with none shows the default. `kind` is `verify-email`, which is
  also what a missing one means; `scheme` is `light` (also when left out) or
  `dark` and fixes the palette and logo a mail client would otherwise choose by
  its own setting; `locale` is `en` or `ar`, else the tenant's `default_locale`,
  else English. The default mark is carried as a `data:` address. The response
  is meant for a frame whose parent is the same origin: its policy allows no
  script and images only from the logo's origin, and `no-store` keeps it out of
  caches. An unknown `kind`, `scheme` or `locale` is `400`. Nothing is queued,
  saved or sent.
- `GET /mail/branding` answers what that mail inherits: for `light` and `dark`
  the nine colours (`page`, `panel`, `sunken`, `border`, `ink`, `muted`, `link`,
  `button`, `button_ink`) with a `source` of `tenant` when the published theme
  sets that scheme and `default` when Odudu's own colours are used, and the
  `logo` and `dark_logo` as `src`, `alt`, `width` and `height`, or `null`. These show the tenant's own look.
- `GET /clients/:id/mail/preview` and `GET /clients/:id/mail/branding` take the
  same query and answer the same shapes for the mail a sign-in of that client
  sends: its published logo and colours over the tenant's, piece by piece, and
  the tenant's wording. In the branding answer a palette's `source` is `client`
  where the client's theme sets it, else `tenant` or `default`. A client that is
  disabled shows the tenant's look, as its mail would. A client the tenant does
  not hold, another tenant's included, is the same `404`.

## The verification mail, before and after a theme

Everything below ran in one session against a freshly built stack, in a tenant
`mail-demo` created for this page. `$ADMIN_TOKEN` is `ada`'s token from [Getting
the token](./getting-the-token.md). The tenant is created, and with no theme
published its mail takes Odudu's own colours for both schemes and carries no
logo:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"mail-demo","display_name":"Mail Demo"}' \
  http://localhost:3000/admin/tenants | jq -c '{name, display_name, enabled}'
```

```
{"name":"mail-demo","display_name":"Mail Demo","enabled":true}
```

```bash
P=http://localhost:3000/admin/tenants/mail-demo
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/mail/branding
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b58-71e2-79d8-ae08-240127c55aad
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 443
Date: Fri, 30 Oct 2026 05:46:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"light":{"source":"default","colours":{"page":"#e7eae9","panel":"#ffffff","sunken":"#f3f5f4","border":"#d4d9d7","ink":"#161b1a","muted":"#56605d","link":"#0a6344","button":"#161b1a","button_ink":"#ffffff"}},"dark":{"source":"default","colours":{"page":"#151a19","panel":"#1c2221","sunken":"#121716","border":"#2a3230","ink":"#e4e9e7","muted":"#9ba6a2","link":"#6fd8a8","button":"#e4e9e7","button_ink":"#1c2221"}},"logo":null,"dark_logo":null}
```

The preview of that mail answers a document whose policy allows images from
`data:` addresses only, because the one image it carries is Odudu's own mark, as
a `data:` address (the second line counts them):

```bash
curl -sS -D - -o default-mail.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview"
grep -c 'data:image' default-mail.html
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b58-722a-7566-908d-df3a60889745
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
referrer-policy: no-referrer
x-content-type-options: nosniff
content-length: 6856
Date: Fri, 30 Oct 2026 05:46:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

1
```

### With a published theme

The theme below sets both palettes and a light and a dark logo, uploaded first
(`logo.png` and `dark-logo.png` are 96 by 32 pixel PNGs made for this page). The
mail reads the published version only, so nothing changes until it is published:

```bash
LOGO=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @logo.png "$P/theme/assets?kind=logo" | jq -r .id)
DARK=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @dark-logo.png "$P/theme/assets?kind=darkLogo" | jq -r .id)
cat > mail-theme.json <<EOF
{
  "tokens": {
    "light": {
      "surfacePage": "#fff4e0", "surfacePanel": "#fffaf0", "surfaceSunken": "#f0e6d0",
      "inkPrimary": "#111111", "inkMuted": "#555555",
      "signalActive": "#ddeedd", "signalActiveInk": "#004400",
      "signalDanger": "#fde0d0", "signalDangerInk": "#802000",
      "borderStrong": "#777777", "focusRing": "#0044aa"
    },
    "dark": {
      "surfacePage": "#101010", "surfacePanel": "#181818", "surfaceSunken": "#0c0c0c",
      "inkPrimary": "#f0f0f0", "inkMuted": "#b0b0b0",
      "signalActive": "#223322", "signalActiveInk": "#aaffaa",
      "signalDanger": "#401000", "signalDangerInk": "#ffb090",
      "borderStrong": "#999999", "focusRing": "#66aaff"
    }
  },
  "assets": {
    "logo": {"assetId": "$LOGO", "alt": "Mail Demo"},
    "darkLogo": {"assetId": "$DARK", "alt": "Mail Demo"}
  }
}
EOF
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @mail-theme.json $P/theme
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/mail/branding | jq -c .
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/mail/branding
```

```
200
{"light":{"source":"default","colours":{"page":"#e7eae9","panel":"#ffffff","sunken":"#f3f5f4","border":"#d4d9d7","ink":"#161b1a","muted":"#56605d","link":"#0a6344","button":"#161b1a","button_ink":"#ffffff"}},"dark":{"source":"default","colours":{"page":"#151a19","panel":"#1c2221","sunken":"#121716","border":"#2a3230","ink":"#e4e9e7","muted":"#9ba6a2","link":"#6fd8a8","button":"#e4e9e7","button_ink":"#1c2221"}},"logo":null,"dark_logo":null}
200
HTTP/1.1 200 OK
x-request-id: 01a18b58-72f8-7760-9785-1b0a976116d8
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 763
Date: Fri, 30 Oct 2026 05:46:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"light":{"source":"tenant","colours":{"page":"#fff4e0","panel":"#fffaf0","sunken":"#f0e6d0","border":"#777777","ink":"#111111","muted":"#555555","link":"#004400","button":"#ddeedd","button_ink":"#004400"}},"dark":{"source":"tenant","colours":{"page":"#101010","panel":"#181818","sunken":"#0c0c0c","border":"#999999","ink":"#f0f0f0","muted":"#b0b0b0","link":"#aaffaa","button":"#223322","button_ink":"#aaffaa"}},"logo":{"src":"http://localhost:3000/tenants/mail-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png","alt":"Mail Demo","width":96,"height":32},"dark_logo":{"src":"http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png","alt":"Mail Demo","width":96,"height":32}}
```

The preview is the mail itself, built by the code that builds the real one, with
a sample address and link. The light palette and logo are the default; `scheme=dark`
fixes the dark ones; the `Content-Security-Policy` allows images from `data:`
addresses and from the origin the logos are served from, and nothing else, and
the response is `no-store`:

```bash
curl -sS -D - -o mail-light.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview"
grep -o -E '<title>[^<]*</title>|background(-color)?:#[0-9a-f]{6}|<img [^>]*>' mail-light.html | sort -u | head -8
curl -sS -o mail-dark.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?scheme=dark"
grep -o -E 'background(-color)?:#[0-9a-f]{6}|<img [^>]*>' mail-dark.html | sort -u | head -8
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b58-730e-78a5-a2ae-16865d696ec7
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: http://localhost:3000; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
referrer-policy: no-referrer
x-content-type-options: nosniff
content-length: 6198
Date: Fri, 30 Oct 2026 05:46:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<img class="m-logo-dark" src="http://localhost:3000/tenants/mail-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png" width="96" height="32" alt="Mail Demo" style="display:none;mso-hide:all;width:96px;height:32px;border:0;font:600 14px/32px system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#111111">
<img class="m-logo-light" src="http://localhost:3000/tenants/mail-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png" width="96" height="32" alt="Mail Demo" style="display:block;width:96px;height:32px;border:0;font:600 14px/32px system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#111111">
<title>Verify your email address</title>
background-color:#ddeedd
background-color:#f0e6d0
background-color:#fff4e0
background-color:#fffaf0
<img class="m-logo-dark" src="http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png" width="96" height="32" alt="Mail Demo" style="display:none;mso-hide:all;width:96px;height:32px;border:0;font:600 14px/32px system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#f0f0f0">
<img class="m-logo-light" src="http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png" width="96" height="32" alt="Mail Demo" style="display:block;width:96px;height:32px;border:0;font:600 14px/32px system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#f0f0f0">
background-color:#0c0c0c
background-color:#101010
background-color:#181818
background-color:#223322
```

### The language, and what is refused

The mail's language is `locale` when it is one the mail has, else the tenant's
`default_locale`, else English. An unknown `kind`, `scheme` or `locale` is `400`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?locale=ar" | grep -o -E '<html[^>]*>|<title>[^<]*</title>'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?kind=reset"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?scheme=sepia"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?locale=xx"
echo
```

```
<html lang="ar" dir="rtl">
<title>تحقق من عنوان بريدك الإلكتروني</title>
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/kind must be equal to one of the allowed values","errors":[{"path":"kind","message":"must be equal to one of the allowed values"}],"instance":"01a18b58-7359-7e3b-aa82-9ab23640fb0b"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/scheme must be equal to one of the allowed values","errors":[{"path":"scheme","message":"must be equal to one of the allowed values"}],"instance":"01a18b58-7363-71c4-9fd8-4f7e075d0d2c"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/locale must be equal to one of the allowed values","errors":[{"path":"locale","message":"must be equal to one of the allowed values"}],"instance":"01a18b58-736c-78b5-bce2-63a9c693eb54"}
```

### The tenant's own wording

A mail is worded from the tenant's message overrides, the same ones its pages use, so
the preview shows a change at once. The tenant overrides `verify.heading` in English
with a `PUT` that creates it (`If-None-Match: *`); the answer is the override and its
`ETag`. The preview carries the new heading in its `<title>` and its `<h1>`, and the
Arabic preview, which has no override, keeps the shipped text:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H 'If-None-Match: *' \
  -d '{"message":"Please confirm your address"}' $P/message-overrides/en/verify.heading
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview" | grep -o -E '<title>[^<]*</title>|<h1[^>]*>[^<]*</h1>'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail/preview?locale=ar" | grep -o -E '<title>[^<]*</title>'
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b58-7376-7d65-aa1e-7f8b92450a47
cache-control: no-store
etag: "a54e814725613408e3b806ae3fbfe761414bd11e4dd6a7609155ffe34b0be481"
content-type: application/json; charset=utf-8
content-length: 196
Date: Fri, 30 Oct 2026 05:46:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"locale":"en","key":"verify.heading","message":"Please confirm your address","updated_at":"2026-10-30T05:46:32.192Z","etag":"\"a54e814725613408e3b806ae3fbfe761414bd11e4dd6a7609155ffe34b0be481\""}
<title>Please confirm your address</title>
<h1 class="m-ink" style="margin:0 0 16px;font:600 20px/1.3 system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#111111;text-align:left;word-break:break-word;overflow-wrap:anywhere">Please confirm your address</h1>
<title>تحقق من عنوان بريدك الإلكتروني</title>
```

### A client's mail

A client's mail takes its own published logo and palette over the tenant's, one piece at a
time. `portal` is a public client of `mail-demo`; its theme sets the light palette and a
logo (`client-logo.png`, another 96 by 32 pixel PNG made for this page) and
nothing else. `grace` is a user with an address, and the tenant lets users ask for a reset
link, which the last part of this section needs:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"reset_password_allowed":true}' $P/settings | jq -c '{reset_password_allowed}'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{client_id, type}'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"grace","email":"grace@navy.example"}' $P/subjects | jq -c '{username, email}'
```

```
{"reset_password_allowed":true}
{"client_id":"portal","type":"public"}
{"username":"grace","email":"grace@navy.example"}
```

```bash
CID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients?client_id_exact=portal" | jq -r '.items[0].id')
CLIENT_LOGO=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @client-logo.png "$P/theme/assets?kind=logo" | jq -r .id)
jq -n --arg id "$CLIENT_LOGO" '{
  tokens: { light: {
    surfacePage: "#e8f0ff", surfacePanel: "#f4f8ff", surfaceSunken: "#d8e4f8",
    inkPrimary: "#111111", inkMuted: "#555555",
    signalActive: "#ddeedd", signalActiveInk: "#004400",
    signalDanger: "#fde0d0", signalDangerInk: "#802000",
    borderStrong: "#777777", focusRing: "#0044aa" } },
  assets: { logo: { assetId: $id, alt: "Portal" } }
}' > client-mail-theme.json
```

The client's theme is saved and published, and its mail routes answer. In the branding,
the light palette and the logo name the `client`, and the dark palette and the dark logo,
which the client does not set, stay the tenant's:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @client-mail-theme.json $P/clients/$CID/theme
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme/publish
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/mail/branding
```

```
200
200
HTTP/1.1 200 OK
x-request-id: 01a18b58-749b-7beb-bd90-1b04bee09cd4
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 760
Date: Fri, 30 Oct 2026 05:46:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"light":{"source":"client","colours":{"page":"#e8f0ff","panel":"#f4f8ff","sunken":"#d8e4f8","border":"#777777","ink":"#111111","muted":"#555555","link":"#004400","button":"#ddeedd","button_ink":"#004400"}},"dark":{"source":"tenant","colours":{"page":"#101010","panel":"#181818","sunken":"#0c0c0c","border":"#999999","ink":"#f0f0f0","muted":"#b0b0b0","link":"#aaffaa","button":"#223322","button_ink":"#aaffaa"}},"logo":{"src":"http://localhost:3000/tenants/mail-demo/brand/265ffac882aa7e2f48610beb6b4c66bddd27ccddc52715b5857754914e5ab27e.png","alt":"Portal","width":96,"height":32},"dark_logo":{"src":"http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png","alt":"Mail Demo","width":96,"height":32}}
```

The client's preview is its mail: the light palette is the client's, the heading is the
tenant's own wording from above, and the logo is the client's. A client the tenant does
not hold is `404`:

```bash
curl -sS -D - -o client-mail.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients/$CID/mail/preview"
grep -o -E '<title>[^<]*</title>|background(-color)?:#[0-9a-f]{6}|<img [^>]*>' client-mail.html | sort -u | cut -c1-230
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/01a18705-0000-7000-8000-000000000000/mail/preview
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/01a18705-0000-7000-8000-000000000000/mail/branding
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b58-74b2-700c-b7ac-b57b2770d553
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: http://localhost:3000; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
referrer-policy: no-referrer
x-content-type-options: nosniff
content-length: 6196
Date: Fri, 30 Oct 2026 05:46:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<img class="m-logo-dark" src="http://localhost:3000/tenants/mail-demo/brand/265ffac882aa7e2f48610beb6b4c66bddd27ccddc52715b5857754914e5ab27e.png" width="96" height="32" alt="Portal" style="display:none;mso-hide:all;width:96px;heig
<img class="m-logo-light" src="http://localhost:3000/tenants/mail-demo/brand/265ffac882aa7e2f48610beb6b4c66bddd27ccddc52715b5857754914e5ab27e.png" width="96" height="32" alt="Portal" style="display:block;width:96px;height:32px;bor
<title>Please confirm your address</title>
background-color:#d8e4f8
background-color:#ddeedd
background-color:#e8f0ff
background-color:#f4f8ff
404
404
```

### A mail queued out of a client's sign-in

The mail a person is sent wears the same look. This part ran against a stack whose
deployment sender is a Mailpit (`ODUDU_SMTP_HOST` set to
it, its web port published on `8725`), emptied first. `grace` asks for a reset link from
the sign-in page of `portal`: the authorization request, the link on its page, and the
form that link opens, whose `return_to` names that request:

```bash
curl -sS -X DELETE http://localhost:8725/api/v1/messages
echo
AUTHORIZE="http://localhost:3000/tenants/mail-demo/protocol/openid-connect/auth?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
rm -f jar
LINK=$(curl -sS -c jar -b jar "$AUTHORIZE" | sed -n 's/.*href="\(\/tenants[^"]*reset-password[^"]*\)".*/\1/p' | sed 's/&amp;/\&/g')
RETURN_TO=$(curl -sS -c jar -b jar "http://localhost:3000$LINK" | sed -n 's/.*name="return_to" value="\([^"]*\)".*/\1/p' | sed 's/&amp;/\&/g')
echo "$RETURN_TO"
curl -sS -c jar -b jar -o /dev/null -w '%{http_code}\n' --data-urlencode "return_to=$RETURN_TO" \
  --data-urlencode 'email=grace@navy.example' http://localhost:3000/tenants/mail-demo/login-actions/reset-password
```

```
ok
/tenants/mail-demo/protocol/openid-connect/auth?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=s
200
```

Mailpit then holds the message, sent by the server's own schedule. Its recipient and
subject, and the logo and colours its HTML names, are the client's: the logo is the one
uploaded for `portal`, and the page is `#e8f0ff`, not the tenant's `#fff4e0`:

```bash
until [ "$(curl -sS http://localhost:8725/api/v1/messages | jq .messages_count)" -ge 1 ]; do sleep 1; done
curl -sS http://localhost:8725/api/v1/messages | jq -c '.messages[] | {Subject, To: .To[0].Address}'
curl -sS http://localhost:8725/api/v1/message/latest | jq -r .HTML | grep -o -E 'background-color:#[0-9a-f]{6}|<img [^>]*>' | sort -u | cut -c1-230
```

```
{"Subject":"Reset your Mail Demo password","To":"grace@navy.example"}
<img class="m-logo-dark" src="http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png" width="96" height="32" alt="Mail Demo" style="display:none;mso-hide:all;width:96px;h
<img class="m-logo-light" src="http://localhost:3000/tenants/mail-demo/brand/265ffac882aa7e2f48610beb6b4c66bddd27ccddc52715b5857754914e5ab27e.png" width="96" height="32" alt="Portal" style="display:block;width:96px;height:32px;bor
background-color:#0c0c0c
background-color:#101010
background-color:#181818
background-color:#223322
background-color:#d8e4f8
background-color:#ddeedd
background-color:#e8f0ff
background-color:#f4f8ff
```

An administrator's reset link is not asked for from a sign-in, so no client is known and
the mail takes the tenant's look, the logo from `logo.png` and the page `#fff4e0`:

```bash
GRACE=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?username=grace" | jq -r '.items[0].id')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE/password-reset
until [ "$(curl -sS http://localhost:8725/api/v1/messages | jq .messages_count)" -ge 2 ]; do sleep 1; done
curl -sS http://localhost:8725/api/v1/messages | jq -c '.messages[] | {Subject, To: .To[0].Address}'
curl -sS http://localhost:8725/api/v1/message/latest | jq -r .HTML | grep -o -E 'background-color:#[0-9a-f]{6}|<img [^>]*>' | sort -u | cut -c1-230
```

```
202
{"Subject":"Reset your Mail Demo password","To":"grace@navy.example"}
{"Subject":"Reset your Mail Demo password","To":"grace@navy.example"}
<img class="m-logo-dark" src="http://localhost:3000/tenants/mail-demo/brand/be9b189df624ec78263911c1ad44cff7bcdf97e5c50ba104002c664d2dc701a4.png" width="96" height="32" alt="Mail Demo" style="display:none;mso-hide:all;width:96px;h
<img class="m-logo-light" src="http://localhost:3000/tenants/mail-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png" width="96" height="32" alt="Mail Demo" style="display:block;width:96px;height:32px;
background-color:#0c0c0c
background-color:#101010
background-color:#181818
background-color:#223322
background-color:#ddeedd
background-color:#f0e6d0
background-color:#fff4e0
background-color:#fffaf0
```
