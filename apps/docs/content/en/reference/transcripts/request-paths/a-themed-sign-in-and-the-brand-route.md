---
title: 'A themed sign-in and the brand route'
description: 'A tenant’s published theme on the sign-in page, the stylesheet and logo it links from the brand route, and the logout confirmation.'
---

# A themed sign-in and the brand route

A tenant's published theme reaches a person in two parts: the page, filled with the
tenant's colours, template, stylesheet link and logo, and the files that page links,
which the server serves from `/tenants/{tenant}/brand/` under a content hash. This
page publishes a theme for a tenant and follows both. Everything below ran on one
freshly built stack with a tenant `brand-demo` created for it, `ada` signed in to
`system` with the token the [admin paths](../admin-paths/getting-the-token.md)
describe as `$ADMIN_TOKEN`, a public client `portal` and a user `grace`, and
nothing else in the tenant. `$B` is the tenant's protocol path and `$P` its admin
path:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"brand-demo","display_name":"Brand Demo"}' http://localhost:3000/admin/tenants -o /dev/null
```

```bash
B=http://localhost:3000/tenants/brand-demo
P=http://localhost:3000/admin/tenants/brand-demo
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{client_id, type}'
docker compose exec -T odudu node dist/main.js seed user --tenant brand-demo \
  --username grace --password 'correct-horse-battery-8c2' | jq -c '{command, username}'
```

```
{"client_id":"portal","type":"public"}
{"command":"user","username":"grace"}
```

## Before a theme is published

The sign-in page is the default one. It links Instrument's stylesheet and nothing from
the tenant's brand route, and a path under that route answers the same bare `404` that
any file the tenant has not published gets:

```bash
AUTHORIZE="$B/protocol/openid-connect/auth?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
```

```bash
curl -sS "$AUTHORIZE" | grep -n -E '<link|<style|<img|<h1>'
curl -sS -D - -o /dev/null "$B/brand/$(printf '0%.0s' $(seq 1 64)).css"
```

```
8:<link rel="stylesheet" href="/instrument/instrument.css">
9:<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
10:<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
16:<h1>Sign in</h1>
HTTP/1.1 404 Not Found
x-request-id: 01a18b61-8b69-7d3c-aeea-3cf89186d4a0
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
cache-control: no-store
content-length: 0
Date: Fri, 30 Oct 2026 05:56:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Publishing a theme

The theme sets the light palette and a stylesheet that targets the hook `page-sign-in`, and
names an uploaded logo (`logo.png`, a 96 by 32 pixel PNG made for this page) with its
alternative text. Nothing is served until it is published, and the stored draft is
not served either:

```bash
LOGO=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @logo.png "$P/theme/assets?kind=logo" | jq -r .id)
cat > brand-theme.json <<EOF
{
  "tokens": {
    "light": {
      "surfacePage": "#fff4e0", "surfacePanel": "#fffaf0", "surfaceSunken": "#f0e6d0",
      "inkPrimary": "#111111", "inkMuted": "#555555",
      "signalActive": "#ddeedd", "signalActiveInk": "#004400",
      "signalDanger": "#fde0d0", "signalDangerInk": "#802000",
      "borderStrong": "#777777", "focusRing": "#0044aa"
    }
  },
  "stylesheet": ".page-sign-in h1 { border-top: 4px solid #0044aa; }",
  "assets": { "logo": { "assetId": "$LOGO", "alt": "Brand Demo" } }
}
EOF
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @brand-theme.json $P/theme
curl -sS "$AUTHORIZE" | grep -c -E 'brand/'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
```

```
200
0
200
```

## The sign-in page

The same request now answers a page that links the tenant's stylesheet from the brand
route and shows its logo from there. A themed page names its kind on its `<main>`, as
`page page-sign-in`, which is the class the stylesheet's rule targets. The page's policy no longer says `'self'` for
styles and images: `style-src` names the two stylesheet addresses and `img-src` the
logo and the two icons, each in full, so the page can load those files and no other
from this origin. The policy, and the `<link>` and `<img>` lines:

```bash
curl -sS -D headers.txt -o signin.html "$AUTHORIZE"
grep -i -E '^(HTTP|content-type|content-security-policy|content-language)' headers.txt
grep -n -E '<link|<style|<main|<img|<h1>' signin.html
```

```
HTTP/1.1 200 OK
content-type: text/html
content-security-policy: default-src 'none'; style-src http://localhost:3000/instrument/instrument.css http://localhost:3000/tenants/brand-demo/brand/d4392d4df227581c41f775d8865fda254dbb404e82616a1488715652544feb76.css; font-src 'self'; img-src http://localhost:3000/tenants/brand-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png http://localhost:3000/instrument/favicon.svg http://localhost:3000/instrument/favicon.ico; frame-ancestors 'none'; form-action 'self' https://app.example; base-uri 'none'; script-src 'nonce-8ZhMEM+zkBn8PCwi6bvDUw=='; connect-src 'self'
content-language: en
8:<link rel="stylesheet" href="/instrument/instrument.css">
9:<link rel="stylesheet" href="/tenants/brand-demo/brand/d4392d4df227581c41f775d8865fda254dbb404e82616a1488715652544feb76.css">
10:<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
11:<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
14:<main class="page page-sign-in">
15:<p class="brand"><img class="logo" src="/tenants/brand-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png" alt="Brand Demo"></p>
17:<h1>Sign in</h1>
```

## The stylesheet and the logo

The stylesheet carries the tenant's palette as custom properties and then the rule
it wrote, and the file is served as `text/css` for ever under its hash, with no
cookie and nothing specific to a visitor:

```bash
CSS=$(grep -o '/tenants/brand-demo/brand/[0-9a-f]*\.css' signin.html | head -1)
curl -sS -D - "http://localhost:3000$CSS"
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b61-8c10-7e7f-b842-63ea399e980a
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
etag: "d4392d4df227581c41f775d8865fda254dbb404e82616a1488715652544feb76"
cache-control: public, max-age=31536000, immutable
content-type: text/css; charset=utf-8
content-length: 669
Date: Fri, 30 Oct 2026 05:56:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

@media (prefers-color-scheme:light){:root:not([data-theme]){--surface-page:#fff4e0;--surface-panel:#fffaf0;--surface-sunken:#f0e6d0;--ink-primary:#111111;--ink-muted:#555555;--signal-active:#ddeedd;--signal-active-ink:#004400;--signal-danger:#fde0d0;--signal-danger-ink:#802000;--border-strong:#777777;--focus-ring:#0044aa;}}
:root[data-theme='light']{--surface-page:#fff4e0;--surface-panel:#fffaf0;--surface-sunken:#f0e6d0;--ink-primary:#111111;--ink-muted:#555555;--signal-active:#ddeedd;--signal-active-ink:#004400;--signal-danger:#fde0d0;--signal-danger-ink:#802000;--border-strong:#777777;--focus-ring:#0044aa;}
.page-sign-in h1 { border-top: 4px solid #0044aa; }
```

```bash
IMG=$(grep -o '/tenants/brand-demo/brand/[0-9a-f]*\.png' signin.html | head -1)
curl -sS -D - -o brand-logo.png "http://localhost:3000$IMG"
file brand-logo.png
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b61-8c22-747d-b8e1-4e94056baae0
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
etag: "f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba"
cache-control: public, max-age=31536000, immutable
content-type: image/png
content-length: 144
Date: Fri, 30 Oct 2026 05:56:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

brand-logo.png: PNG image data, 96 x 32, 8-bit/color RGB, non-interlaced
```

The name is the hash of the content, so the same file is at the same address on every replica
and a changed theme is at a new one. The hash is the only thing that selects a
file: a hash nothing was published under, another extension for the real one, a
stylesheet's name for the image's hash, and the image's hash under the name of a
tenant that does not exist or of another one all answer the same bare `404`
(the first with its headers, which carry `no-store`), so what the route holds cannot be
told from what it does not:

```bash
SHA=$(basename "$IMG" .png)
curl -sS -D - -o /dev/null "$B/brand/$(printf 'f%.0s' $(seq 1 64)).png"
curl -sS -o /dev/null -w '%{http_code}\n' "$B/brand/$SHA.webp"
curl -sS -o /dev/null -w '%{http_code}\n' "$B/brand/$SHA.css"
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:3000/tenants/no-such-tenant/brand/$SHA.png"
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:3000/tenants/system/brand/$SHA.png"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a18b61-8c38-70ac-95f7-728129345f56
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
cache-control: no-store
content-length: 0
Date: Fri, 30 Oct 2026 05:56:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

404
404
404
404
```

## A background image

A theme may also name a background, which the page draws behind the form, which stays
on its own panel. `background.png` is a 640 by 360 pixel PNG made for this page. It is
uploaded for the `background` slot and the same theme is saved again with it and
published. The page's policy then licenses the image for `img-src` by its address, and
the stylesheet, not the page, draws it: the tenant's file now holds a `body` rule with
`background-image:url(...)`, after the palette and before the tenant's own rules:

```bash
BG=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @background.png "$P/theme/assets?kind=background" | jq -r .id)
jq --arg id "$BG" '.assets.background = {assetId: $id}' brand-theme.json > brand-theme-bg.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @brand-theme-bg.json $P/theme
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
```

```
200
200
```

```bash
curl -sS -D headers.txt -o signin-bg.html "$AUTHORIZE"
grep -i '^content-security-policy' headers.txt | tr -d '\r' | tr ';' '\n' | grep -E 'style-src|img-src'
grep -n -E '<link rel="stylesheet"|<main|<img' signin-bg.html
```

```
 style-src http://localhost:3000/instrument/instrument.css http://localhost:3000/tenants/brand-demo/brand/4bff0170ea31327fa357d39efaa564175856abc1f054975e1a969c76ce64ae87.css
 img-src http://localhost:3000/tenants/brand-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png http://localhost:3000/tenants/brand-demo/brand/c9d7688a6cf8827b7666eb243d6f3abfdfb8a6abc2de5060e485d4159ce134e4.png http://localhost:3000/instrument/favicon.svg http://localhost:3000/instrument/favicon.ico
8:<link rel="stylesheet" href="/instrument/instrument.css">
9:<link rel="stylesheet" href="/tenants/brand-demo/brand/4bff0170ea31327fa357d39efaa564175856abc1f054975e1a969c76ce64ae87.css">
14:<main class="page page-sign-in">
15:<p class="brand"><img class="logo" src="/tenants/brand-demo/brand/f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba.png" alt="Brand Demo"></p>
```

The stylesheet is a new file under a new hash, since the theme changed. The line with the
background's rule is shown, and the image it names is served from the same route as the
logo, as a file that never changes under its hash:

```bash
CSS=$(grep -o '/tenants/brand-demo/brand/[0-9a-f]*\.css' signin-bg.html | head -1)
curl -sS "http://localhost:3000$CSS" | grep -n 'background-image'
BGPATH=$(curl -sS "http://localhost:3000$CSS" | grep -o '/tenants/brand-demo/brand/[0-9a-f]*\.png')
curl -sS -D - -o brand-background.png "http://localhost:3000$BGPATH"
file brand-background.png
```

```
3:body{background-image:url('/tenants/brand-demo/brand/c9d7688a6cf8827b7666eb243d6f3abfdfb8a6abc2de5060e485d4159ce134e4.png');background-size:cover;background-position:center;background-repeat:no-repeat;}
HTTP/1.1 200 OK
x-request-id: 01a18b61-8d07-74bd-9f17-fbed59aaba4c
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
etag: "c9d7688a6cf8827b7666eb243d6f3abfdfb8a6abc2de5060e485d4159ce134e4"
cache-control: public, max-age=31536000, immutable
content-type: image/png
content-length: 1233
Date: Fri, 30 Oct 2026 05:56:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

brand-background.png: PNG image data, 640 x 360, 8-bit/color RGB, non-interlaced
```

## A reset takes the files away

Resetting the theme archives the published version, and its files are no longer served.
The sign-in page links nothing from the brand route again:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:3000$IMG"
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme
curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:3000$IMG"
curl -sS "$AUTHORIZE" | grep -c -E 'brand/'
```

```
200
200
404
0
```

## Signing out always asks

Signing out is confirmed with a page, and the page wears the tenant's theme like the
rest. The theme is published again so the page can be shown; `grace` signs in, and a
logout request with the session cookie and no hint answers the confirmation: `200`
with the form, no `location` and no cookie cleared, so nothing has ended yet:

```bash
curl -sS -o /dev/null -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @brand-theme.json $P/theme
curl -sS -o /dev/null -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
rm -f jar.txt
```

```bash
AUTH_SESSION_ID=$(curl -sS -c jar.txt -b jar.txt "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
curl -sS -c jar.txt -b jar.txt -o /dev/null -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=grace' --data-urlencode 'password=correct-horse-battery-8c2' \
  $B/login-actions/authenticate
curl -sS -D logout-headers.txt -b jar.txt -o logout.html "$B/protocol/openid-connect/logout"
grep -i -E '^(HTTP|content-type|location|set-cookie)' logout-headers.txt
grep -n -E '<link|<title>|<h1>|<button|name="(session_id|csrf)"' logout.html | cut -c1-160
```

```
302
HTTP/1.1 200 OK
content-type: text/html
7:<title>Sign out?</title>
8:<link rel="stylesheet" href="/instrument/instrument.css">
9:<link rel="stylesheet" href="/tenants/brand-demo/brand/d4392d4df227581c41f775d8865fda254dbb404e82616a1488715652544feb76.css">
10:<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
11:<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
16:<h1>Sign out?</h1>
19:  <input type="hidden" name="session_id" value="01a18b61-8df3-7634-830c-d54498a5d0fd">
20:  <input type="hidden" name="csrf" value="wSrhz9XMFxKhbkW60XcK5M7BfkzOoSxOuAQ0zZVSdi0">
21:  <button type="submit">Sign out</button>
```

Confirming posts the form back with its `session_id` and `csrf`. The session ends: the
session cookies are cleared and the answer is the signed-out page. A further request has
no session to confirm, and is told so by the page for that case:

```bash
SESSION_ID=$(sed -n 's/.*name="session_id" value="\([^"]*\)".*/\1/p' logout.html)
CSRF=$(sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p' logout.html)
curl -sS -D - -b jar.txt -o logged-out.html \
  --data-urlencode "session_id=$SESSION_ID" \
  --data-urlencode "csrf=$CSRF" \
  "$B/protocol/openid-connect/logout" | grep -i -E '^(HTTP|location|set-cookie)'
grep -n -E '<title>|<h1>' logged-out.html
curl -sS -b jar.txt "$B/protocol/openid-connect/logout" | grep -n -E '<title>|<h1>'
```

```
HTTP/1.1 200 OK
set-cookie: brand-demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: brand-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
7:<title>Signed out</title>
16:<h1>Signed out</h1>
7:<title>Already signed out</title>
16:<h1>Already signed out</h1>
```
