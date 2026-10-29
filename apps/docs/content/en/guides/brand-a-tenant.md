---
title: Brand a tenant
description: Give a tenant's sign-in page its own colours, logo, stylesheet and layout through the admin API, publish it, look at the result, and go back.
sidebar_position: 11
---

# Brand a tenant

A tenant's people meet Odudu's pages when they sign in, consent or reset a password. This guide gives one tenant, `brand-guide`, its own look through the admin API: colours, a logo, a stylesheet and a layout for the sign-in page. You will save a draft, preview it, publish it, see the page people get, try some refusals, and go back. [Branding](../concepts/branding.mdx) explains the model, and [Branding in the console](../admin-console/branding.mdx) does the same work with screens.

The commands were run, in order, against a running stack, and each output is what came back, trimmed where it is long. They are not in the docs commands job, because they need an administrator's token: [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) shows how to get one that holds `manage-tenants`. Run them in bash or zsh with `curl`, `jq` and `base64` installed, and keep to one terminal, since each step uses the variables of the one before. A token lasts five minutes, so fetch it again when a command answers `401`. The stack they were run against was on port 3226, so the one address in the output that names a port says 3226 where yours says 3000.

## 1. Make a tenant and an app to sign in to

Point the commands at your server and name the token.

```bash
ODUDU_BASE=http://localhost:3000
ADMIN_TOKEN=...   # an access token for the admin API
P=$ODUDU_BASE/admin/tenants/brand-guide
TENANT=$ODUDU_BASE/tenants/brand-guide
```

Make the tenant, and a public client, so that there is a sign-in page to look at.

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"brand-guide","display_name":"Brand Guide"}' \
  $ODUDU_BASE/admin/tenants | jq -c '{name, display_name, enabled}'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"guide-app","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{client_id, type}'
```

```
{"name":"brand-guide","display_name":"Brand Guide","enabled":true}
{"client_id":"guide-app","type":"public"}
```

Ask for the sign-in page the way an app would, and keep it. Nothing is themed yet, so it is Odudu's own page, drawn from the stylesheet `/instrument/instrument.css`:

```bash
cat > signin.sh <<'EOF'
curl -sS -c jar -b jar -D headers.txt -o signin.html \
  "$TENANT/protocol/openid-connect/auth?response_type=code&client_id=guide-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
EOF
. ./signin.sh
grep -n -E '<link rel="stylesheet"|<h1>|class="logo' signin.html
```

```
8:<link rel="stylesheet" href="/instrument/instrument.css">
16:<h1>Sign in</h1>
```

## 2. Upload a logo

An image is uploaded on its own, as the body of the request, and the answer names it. This one makes a small blue disc; use your own PNG, JPEG or WebP, up to 256 KiB and 1024 pixels for a logo.

```bash
echo iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAtElEQVR42u3b0Q2AIAxAQYdzWpfUGVSgLb0mDvAu8QfKcRhjTOSc190j8uvXMro0xozwEhArwtNCRMSnQIgMD4fIFL8cIWP8MoTM8dMRKsRPQ6gUPwWhNUDF+GEIleOHILQG2CH+F0JrgJ3iPyEA6AywY/wrBAAAAAAA0BVg53gIfgEAAAAAAOA8AAAAp8IA3AwBcDtsPwCAHSFbYvYEbYraFbYt7r2AFyPeDHk1FotjjImaB7ogdQBI1ueyAAAAAElFTkSuQmCC | base64 -d > logo.png
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" \
  --data-binary @logo.png "$P/theme/assets?kind=logo" | tee logo.json | jq -c .
LOGO_ID=$(jq -r .id logo.json)
```

```
{"id":"01a187a4-12fb-7e67-b38e-673a574b60b4","sha256":"a29e9a30ae3bba272037b15dc7a11d55bbc3d23d4e8a167b2781a00619dcda32","mime":"image/png","width":64,"height":64,"bytes":258,"kind":"logo"}
```

The image is decoded and stored again, so its metadata is gone, and the same picture uploaded twice is one image. Nothing serves it until a published theme names it.

## 3. Save a draft

A theme is saved whole, as a draft that nobody sees. The draft below sets the light colours (a scheme is set as a whole group of eleven), the logo with its alt text, a stylesheet, and a template for the sign-in page. Write the stylesheet:

```bash
cat > style.css <<'EOF'
.page-sign-in .logo { height: 3rem; width: auto; }
.page-sign-in h1 { letter-spacing: 0.04em; border-top: 4px solid var(--focus-ring); padding-top: var(--space-3); }
.page-sign-in small a { text-decoration: underline; }
EOF
```

The rules name only classes, elements and design values from the [branding reference](../reference/generated/branding.md#css-hooks). `page-sign-in` is the class for the sign-in page; the server does not put it on the page, so the template does, in the next step.

Write the template, which is covered under [Change a page's layout by hand](#change-a-pages-layout-by-hand):

```bash
cat > signin.tpl <<'EOF'
<div class="page-sign-in">
  <h1>{{t "login.title"}}</h1>
  {{error}}
  {{form.open}}
    {{fields}}
    {{submit}}
  {{form.close}}
  <p class="help"><small>Need help? <a href="https://example.com/help" rel="noopener noreferrer">Ask the help desk</a></small></p>
</div>
EOF
```

Put the three together as the draft with `jq`, which does the quoting, and save it. The first draft of a tenant needs no `If-Match`, and the answer has its `ETag`:

```bash
jq -n --arg id "$LOGO_ID" --rawfile css style.css --rawfile tpl signin.tpl '{
  tokens: { light: {
    surfacePage: "#fff4e0", surfacePanel: "#fffaf0", surfaceSunken: "#f0e6d0",
    inkPrimary: "#111111", inkMuted: "#555555",
    signalActive: "#ddeedd", signalActiveInk: "#004400",
    signalDanger: "#fde0d0", signalDangerInk: "#802000",
    borderStrong: "#777777", focusRing: "#0044aa" } },
  assets: { logo: { assetId: $id, alt: "Brand Guide" } },
  stylesheet: $css,
  templates: { "sign-in": $tpl }
}' > draft.json
curl -sS -D headers.txt -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @draft.json $P/theme -o saved.json
grep -i -E "^HTTP|^etag" headers.txt | tr -d '\r'
jq -c '{published, draft_sources: (.draft_sources | with_entries(select(.value != "default")))}' saved.json
```

```
HTTP/1.1 200 OK
etag: "a43a95500f8c50a6109db80cb0660604a3e93b1a063e81dbe7aa0de17608efe3"
{"published":null,"draft_sources":{"tokens.light":"tenant","stylesheet":"tenant","templates.sign-in":"tenant","assets.logo":"tenant"}}
```

Nothing is published, and `draft_sources` says what publishing would supply: four pieces from the tenant, and everything else from Instrument's default.

## 4. Preview it

The preview is the real sign-in page filled with sample values, in the light or dark scheme, built from the draft. The stylesheet is inside it and the logo is part of it, so it shows even though nothing is published.

```bash
curl -sS -o preview.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/theme/preview?kind=sign-in&scheme=light" -w '%{http_code}\n'
grep -n -E '<div class="page|<h1>|\.page-sign-in h1|Need help' preview.html | cut -c1-120
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/theme/preview/info?kind=sign-in"
```

```
200
12:.page-sign-in h1 { letter-spacing: 0.04em; border-top: 4px solid var(--focus-ring); padding-top: var(--space-3); }
20:<div class="page-sign-in">
21:  <h1>Sign in</h1>
30:  <p class="help"><small>Need help? <a href="https://example.com/help" rel="noopener noreferrer">Ask the help desk</a></small></p>
{"kind":"sign-in","from":"draft","shown":"tenant","faults":[],"refused":[],"unfilled":false}
```

`from` says the preview was built from the draft and `shown` that the tenant's own layer drew the page. If a layer had been left out, or a template had been refused, `faults` and `refused` would say which and why.

## 5. Publish

Publishing checks everything again, including the contrast of every colour pair, and makes the draft version 1. The stylesheet and the template cannot be proven accessible, so each is a warning, which does not stop the publish:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish | jq -c '{version: .published.version, sources: (.sources | with_entries(select(.value != "default"))), warnings: [.warnings[].piece]}'
```

```
{"version":1,"sources":{"tokens.light":"tenant","stylesheet":"tenant","templates.sign-in":"tenant","assets.logo":"tenant"},"warnings":["stylesheet","templates.sign-in"]}
```

Another replica of the server shows the previous theme for up to 30 seconds after a publish, the lifetime of its cache.

## 6. See the page people get

Ask for the sign-in page again, as the app would.

```bash
. ./signin.sh
grep -i "^content-security" headers.txt | tr -d '\r'
grep -n -E 'stylesheet|class="logo|<div class="page|<h1>' signin.html | cut -c1-200
```

```
content-security-policy: default-src 'none'; style-src http://localhost:3226/instrument/instrument.css http://localhost:3226/tenants/brand-guide/brand/e5c1f0b59d1ee47789b8e5cea965b573995e05914e97a286b0452a6f14c040bc.css; font-src 'self'; img-src http://localhost:3226/tenants/brand-guide/brand/a29e9a30ae3bba272037b15dc7a11d55bbc3d23d4e8a167b2781a00619dcda32.png http://localhost:3226/instrument/favicon.svg http://localhost:3226/instrument/favicon.ico; frame-ancestors 'none'; form-action 'self' https://app.example; base-uri 'none'; script-src 'nonce-TG3NDkwS8Mg3OUfsjidczQ=='; connect-src 'self'
8:<link rel="stylesheet" href="/instrument/instrument.css">
9:<link rel="stylesheet" href="/tenants/brand-guide/brand/e5c1f0b59d1ee47789b8e5cea965b573995e05914e97a286b0452a6f14c040bc.css">
15:<p class="brand"><img class="logo" src="/tenants/brand-guide/brand/a29e9a30ae3bba272037b15dc7a11d55bbc3d23d4e8a167b2781a00619dcda32.png" alt="Brand Guide"></p>
16:<div class="page-sign-in">
17:  <h1>Sign in</h1>
```

The page's policy was written for this theme. Its `style-src` and `img-src` name exactly the stylesheet and the logo by address, and no policy was widened for any other tenant. The names are hashes of the contents, so a changed theme is a new address. The server draws the logo itself, above the template. Fetch the stylesheet from the address in the page:

```bash
CSS_HREF=$(sed -n 's/.*<link rel="stylesheet" href="\(\/tenants[^"]*\)".*/\1/p' signin.html)
curl -sS -D - $ODUDU_BASE$CSS_HREF | tr -d '\r' | grep -v -E "^(Date|Connection|Keep-Alive|x-request-id)"
```

```
HTTP/1.1 200 OK
x-content-type-options: nosniff
etag: "e5c1f0b59d1ee47789b8e5cea965b573995e05914e97a286b0452a6f14c040bc"
cache-control: public, max-age=31536000, immutable
content-type: text/css; charset=utf-8
content-length: 838

@media (prefers-color-scheme:light){:root:not([data-theme]){--surface-page:#fff4e0;--surface-panel:#fffaf0;--surface-sunken:#f0e6d0;--ink-primary:#111111;--ink-muted:#555555;--signal-active:#ddeedd;--signal-active-ink:#004400;--signal-danger:#fde0d0;--signal-danger-ink:#802000;--border-strong:#777777;--focus-ring:#0044aa;}}
:root[data-theme='light']{--surface-page:#fff4e0;--surface-panel:#fffaf0;--surface-sunken:#f0e6d0;--ink-primary:#111111;--ink-muted:#555555;--signal-active:#ddeedd;--signal-active-ink:#004400;--signal-danger:#fde0d0;--signal-danger-ink:#802000;--border-strong:#777777;--focus-ring:#0044aa;}
.page-sign-in .logo { height: 3rem; width: auto; }
.page-sign-in h1 { letter-spacing: 0.04em; border-top: 4px solid var(--focus-ring); padding-top: var(--space-3); }
.page-sign-in small a { text-decoration: underline; }
```

It is the palette as custom properties, then your rules. It is served as a file of its own and never inside a page, with a lifetime of a year, because its address changes when it does.

## Change a page's layout by hand

A template is the HTML of one page kind, and what the sign-in step above used is the shape of all of them. This is the same template, written out. It is what the console's **Pages** tab edits:

```
<div class="page-sign-in">
  <h1>{{t "login.title"}}</h1>
  {{error}}
  {{form.open}}
    {{fields}}
    {{submit}}
  {{form.close}}
  <p class="help"><small>Need help? <a href="https://example.com/help" rel="noopener noreferrer">Ask the help desk</a></small></p>
</div>
```

The rules:

- The server owns the form. A template places `{{form.open}}`, the parts that belong in the form and `{{form.close}}`, and cannot write a form, an input or a button of its own, so it cannot drop or forge a hidden field.
- Every required part is placed exactly once, and an optional one at most once. The sign-in page requires `{{form.open}}`, `{{fields}}`, `{{submit}}`, `{{error}}` and `{{form.close}}`, and offers `{{intro}}`, `{{links}}` and `{{passkey}}`. The [branding reference](../reference/generated/branding.md#page-kinds-and-their-parts) lists every page kind.
- `{{form.open}}` comes before `{{form.close}}`, and `{{fields}}` and `{{submit}}` sit between them.
- A slot that the page kind does not have is refused. So is a slot written inside an attribute or a comment.
- `{{t "login.title"}}` inserts a message from the page's catalogue in the visitor's language, so the template follows the tenant's languages and its message overrides. A key the catalogue does not hold is refused.
- Plain HTML only: no scripts, styles, forms, inputs, buttons, frames or event attributes. A link must go to an `https` address and carry `rel="noopener noreferrer"`. An image must be one the theme itself uploaded, and carry `alt` text.
- The server does not put the page-kind class on the page, so a template that wants one of the `page-` hooks writes it, as the first line does.

What refuses a template is shown by saving some. Each refusal is a `400`, and the draft is left as it was:

```bash
cat > try-template.sh <<'EOF'
try_template() {
  curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$1" '{templates: {"sign-in": $t}}')" $P/theme | jq -c '.errors[] | {code, detail}'
}
EOF
. ./try-template.sh
try_template '<script>alert(1)</script>{{error}}{{form.open}}{{fields}}{{sidebar}}{{submit}}{{form.close}}'
try_template '{{error}}{{form.open}}{{fields}}{{fields}}{{form.close}}'
try_template '{{fields}}{{error}}{{form.open}}{{submit}}{{form.close}}'
try_template '{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}<a href="http://example.com">help</a>'
try_template '<img src="https://example.com/x.png" alt="x">{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}'
```

```
{"code":"unknown-slot","detail":"sidebar"}
{"code":"element-not-allowed","detail":"script"}
{"code":"missing-part","detail":"submit"}
{"code":"repeated-part","detail":"fields"}
{"code":"form-placement","detail":"fields"}
{"code":"href-not-https","detail":"a href"}
{"code":"link-rel","detail":"a rel"}
{"code":"img-src","detail":"img src"}
```

In order: a script and a slot the page has no part for; a missing `{{submit}}` and a doubled `{{fields}}`; `{{fields}}` outside the form; a link that is not `https` and has no `rel`; an image that is not the theme's. A `<form>` is refused as an element, and the other codes, such as `slot-in-attribute`, `comment`, `unknown-message-key` and `form-pair`, name the rule from the list above. Each refusal carries the `line` and `column` of what it is about. The draft is untouched:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, published: .published.version}'
```

```
{"draft":null,"published":1}
```

## 7. A second version, and going back

Change the focus colour and publish again. The draft is gone after a publish, so this one needs no `If-Match`. The first version is archived, and the versions list is newest first:

```bash
sed -i.bak 's/#0044aa/#8a2be2/g' draft.json
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @draft.json $P/theme -o /dev/null -w '%{http_code}\n'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish | jq -c '{version: .published.version}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {id, version, state}'
```

```
200
{"version":2}
{"id":"01a187a5-5a28-77ae-85b6-f617ab78237c","version":2,"state":"published"}
{"id":"01a187a5-19ea-73f2-8483-edefed40ba2b","version":1,"state":"archived"}
```

Restoring version 1 publishes a copy of it as a new version and leaves the draft alone:

```bash
FIRST=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -r '.items[] | select(.version == 1) | .id')
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions/$FIRST/restore | jq -c '{version: .published.version}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {version, state}'
```

```
{"version":3}
{"version":3,"state":"published"}
{"version":2,"state":"archived"}
{"version":1,"state":"archived"}
```

A tenant keeps its twenty newest versions.

## 8. Take the branding away

Reset deletes the draft and unpublishes the theme, so every piece is Instrument's again. The versions stay in the list:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme -o /dev/null -w '%{http_code}\n'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, published, sources: (.sources | with_entries(select(.value != "default")))}'
rm -f jar; . ./signin.sh
grep -c -E "brand-guide/brand|Need help" signin.html
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {version, state}'
```

```
200
{"draft":null,"published":null,"sources":{}}
0
{"version":3,"state":"archived"}
{"version":2,"state":"archived"}
{"version":1,"state":"archived"}
```

The page has none of the tenant's branding, and the three versions can be restored.

## Where to go next

A client can override any piece for its own sign-in, and mail follows the tenant's theme only. [Branding](../concepts/branding.mdx) explains both, and the languages the pages are offered in. The calls this guide made are in the [theme area of the admin API](../reference/generated/admin-api/theme/index.md), with [recorded transcripts](../reference/transcripts/admin-paths/get-theme-put-theme-and-the-theme-routes.md).
