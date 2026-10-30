---
title: 'Theme: draft, publish, versions, restore, reset'
description: 'A tenant’s branding, and a client’s over it, saved as a draft and published whole. manage-tenant for the tenant, manage-clients for a client.'
---

# Theme: draft, publish, versions, restore, reset

This page covers `GET /theme`, `PUT /theme`, `POST /theme/publish`, `GET /theme/versions`, `POST /theme/versions/{versionId}/restore`, `DELETE /theme`, `DELETE /theme/draft`, `GET /theme/preview`, `GET /theme/preview/info`, `GET /clients/:id/theme`, `PUT /clients/:id/theme`, `POST /clients/:id/theme/publish`, `GET /clients/:id/theme/versions`, `POST /clients/:id/theme/versions/{versionId}/restore`, `DELETE /clients/:id/theme`, `DELETE /clients/:id/theme/draft` `GET /clients/:id/theme/preview` and `GET /clients/:id/theme/preview/info`, and the tenant's image routes `POST /theme/assets`, `GET /theme/assets/{assetId}/content` `DELETE /theme/assets/{assetId}`, and `GET /theme/stylesheet-hooks`.

The tenant's own theme needs `manage-tenant` and a client's `manage-clients`,
the capability every other client route needs. A client is named by its row `id`;
one of another tenant, or that does not exist, answers `404`.

- `GET /theme` answers the draft, the published version, and for each piece the
  layer that supplies it: `sources` for what users see now, `draft_sources` for
  what publishing the draft would give. A layer is `client`, `tenant` or
  `default`. A client's pieces fall back to the tenant's, one piece at a time.
  `changed` lists the parts of the draft (`tokens`, `assets`, `stylesheet`,
  `templates`) that differ from the scope's own published theme, which the server
  compares on their stored form; it is empty without a draft, and a scope with
  nothing published compares as the empty theme.
- `PUT /theme` saves the whole draft. The first draft of a scope needs no
  `If-Match`; once one exists the write must send the draft's `ETag`, refused with
  `428` when it is missing or `*` and with `412` when it is stale, leaving the
  draft as it was. A body over 4 MiB is refused with `413` before it is read.
  Templates, stylesheet and images are checked as they are on publish, except
  contrast. A refusal is `400` with `errors`, each carrying `path`, `code` and,
  for a template or stylesheet, `detail`, `line` and `column`; `detail` quotes
  what the author wrote, cut to 80 characters and cleaned of control characters.
  A `{{t "key"}}` the page's catalogue does not hold is refused.
- `POST /theme/publish` runs every check again. A text or UI contrast pair
  below its ratio is a `400` naming the colour (`tokens.light.inkMuted`). A
  stylesheet or a template cannot be proven accessible, so each is a `warnings`
  entry, which does not block. `409` (`about:blank#theme-no-draft`) when there
  is no draft, which is also what the second of two simultaneous publishes of
  one draft receives, and `409` (`about:blank#theme-nothing-to-publish`) when the
  draft has the published content, which would add a version identical to the last.
- `GET /theme/versions` lists at most 20 versions, newest first, without bodies.
- `POST /theme/versions/{versionId}/restore` publishes a copy of an earlier
  version, whole, and leaves the draft alone. Refused with `409`
  (`about:blank#theme-assets-missing`) when an image it names has been deleted.
- `GET /theme/preview?kind=&scheme=` (and `GET /clients/:id/theme/preview`) answers one
  page of the draft as an HTML document: the page kind (`sign-in` when left out)
  rendered by the same code users are sent, with sample values, in the `light`
  or `dark` palette if `scheme` asks. A client's draft is shown over its tenant's
  published theme, and a scope with no draft shows its own published theme, then what is below it. The
  stylesheet is inside the document in a `<style>` element that the response's
  policy names by hash, and the images the page shows as `data:` addresses, so
  an image that no public address serves still appears; together
  they may come to about 2.2 MiB, counting an image once for each place it is written, past which the answer is `422`
  (`about:blank#theme-preview-too-large`). The response is meant for a frame
  whose parent is the same origin: its policy allows no script, so a page that
  needs one (`passkey-enrolment`) is rendered without it and the response says
  `X-Odudu-Preview-Script: omitted`. A template that cannot be filled shows the default page, and `X-Odudu-Preview-Fallback` lists the kinds. Through the console it is
  `/console/api/admin/tenants/{tenant}/theme/preview`, which the admin's session
  cookie authorises. An unknown `kind` or `scheme` is `400`. It reads the draft
  and writes nothing.
- `GET /theme/preview/info` (and `GET /clients/:id/theme/preview/info`) takes the
  preview's own query and says what that preview shows and why, because a frame
  cannot read the headers of the page it loads. It answers `kind`; `from`, which is
  the scope's `draft`, its `published` version when it has no draft, or `none`;
  `shown`, the most specific layer the page is drawn from (`client`, `tenant` or
  `default`); `faults`, each layer or stylesheet that was left out with a code
  (`invalid_body`, `image_gone`, `stylesheet_refused`); `refused`, the templates of
  this kind that failed the checks, by layer with their codes; and `unfilled`,
  true when a template passed the checks but could not be filled. It is computed
  by the code that renders the preview, reads at most five rows' worth of
  statements whatever the theme names, and needs the preview's capability.
- `DELETE /theme` deletes the draft and archives the published version, so the
  tenant shows the default and a client shows its tenant's theme. History is kept.
- `DELETE /theme/draft` (`manage-tenant`; `DELETE /clients/:id/theme/draft` needs
  `manage-clients`) deletes the draft and nothing else: the published theme, its
  versions and what users see are untouched. It takes the draft's `ETag` as
  `If-Match` like the other draft writes, `428` when it is missing or `*` and
  `412` when stale; a scope with no draft answers its theme as it is. It is
  audited as `theme.draft_discarded`.

- `POST /theme/assets?kind=logo|darkLogo|favicon|background` uploads an image
  for the tenant's themes (`manage-tenant`, or `manage-clients`, since a client's
  theme names tenant images). The body is the image itself, not
  JSON; a declared type other than `image/png`, `image/jpeg`, `image/webp` or
  `application/octet-stream` is `415`, and none is trusted: the bytes decide.
  The image is decoded and stored re-encoded, so its metadata and anything
  appended are gone, and the answer (`201`) carries the stored `id`, `sha256`,
  `mime`, `width`, `height`, `bytes` and `kind`. The same picture is one image. The caller,
  the `kind` (`400`) and the declared length (`413`) are checked before any of
  the body is read. Limits: `logo`, `darkLogo` and `favicon` 256 KiB and 1024
  pixels, `background` 1 MiB and 2560 pixels, 8 MiB of stored images a tenant
  (`409`, `about:blank#asset-cap`). Other refusals: `415`
  `asset-unsupported-type`, `422` `asset-animated`, `asset-corrupt`,
  `asset-dimensions`, `asset-timeout`, `413` `asset-too-large`, and `503`
  `asset-busy` with `Retry-After` while the server decodes as many images as it
  will. An uploaded image is not served until a published theme names it.
- `GET /theme/assets/{assetId}/content` (the same two capabilities) answers the
  stored bytes of an uploaded image, whether or not a published theme names it:
  how an admin sees an image before any public address serves it. The type is the
  one it was stored as (`image/png`, `image/jpeg` or `image/webp`), with
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: private, no-store`. A
  stored image is at most 1.25 MiB and the read is one statement. `404` for an
  image that does not exist or is another tenant's, `400` for an id that is not
  one. It changes nothing and writes no audit event. The console's Theme tab
  reads it for the thumbnail beside each slot.
- `GET /theme/stylesheet-hooks` (the same two capabilities) answers what a
  stylesheet's rules may name, as the stylesheet check accepts it: `version` of
  the list, the `classes` the pages render, a `page_kind_classes` entry for each
  page kind, the `elements`, the `pseudo_classes` and `pseudo_elements` that may
  follow either, and the design `tokens` a declaration may read with `var()`. A
  stylesheet cannot define a custom property of its own. The same for every
  tenant, under 4 KB, and the read touches no table.
- `DELETE /theme/assets/{assetId}` (the same two capabilities) answers `204`, or `409`
  (`about:blank#asset-in-use`) while a draft or published theme of the tenant or
  of a client names the image, `errors` listing the first 20 by path and
  version. `404` for an image that does not exist or is another tenant's.
  Uploads and deletes are audited as `theme.asset_uploaded` and
  `theme.asset_deleted`, with ids, hash, kind and size and never the bytes.

A publish, a restore and a reset take effect on the next page this process
renders; another replica shows the previous theme for at most 30 seconds, the
lifetime of its cache. Deleting a client or a tenant drops the cache the same
way. A tenant has no rename, so nothing else changes what a cached theme names.
Each write is audited as `theme.draft_saved`, `theme.draft_discarded`,
`theme.published`, `theme.restored` or `theme.reset`, with ids and versions and never the theme itself.

## A theme, end to end

Everything below ran in one session against a freshly built stack (`docker compose
up`, then `odudu seed admin --username ada`), in a tenant `theme-demo` created for
this page and holding nothing else. The ids, `ETag`s and timestamps refer to each
other and to nothing on another page. `$P` is the tenant's admin path, and
`$ADMIN_TOKEN` is `ada`'s token from [Getting the token](./getting-the-token.md):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"theme-demo","display_name":"Theme Demo"}' \
  http://localhost:3000/admin/tenants | jq -c '{name, display_name, enabled}'
```

```
{"name":"theme-demo","display_name":"Theme Demo","enabled":true}
```

```bash
P=http://localhost:3000/admin/tenants/theme-demo
```

A tenant that has never been themed has no draft and no published version, and
every piece (`sources`) comes from `default`. `tenant_sources` is `null`: it is
what a client's view says about its tenant, and a tenant has none above it:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-ac86-71d9-b652-e38018e636e0
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 921
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":null,"published":null,"sources":{"tokens.light":"default","tokens.dark":"default","tokens.font":"default","stylesheet":"default","templates.sign-in":"default","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":null,"changed":[]}
```

### A theme that is refused is not saved

A template, a stylesheet and the catalogue are checked as the draft is saved. Each
refusal is a `400` listing every problem with the `path` of the piece, a `code` and
the `detail` that names what the author wrote, with its `line` and `column`. The
first body uses an element a template may not (`main`); the second names a message
the sign-in page is not filled from; the third a class that is not one of the
page's documented hooks. The last request reads the tenant back: nothing was
saved by any of them.

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"templates":{"sign-in":"<main><h1>{{t \"login.title\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</main>"}}' \
  $P/theme
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"templates":{"sign-in":"<div><h1>{{t \"login.nope\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"}}' \
  $P/theme
echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"stylesheet":".warm { color: red; }"}' \
  $P/theme
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, published}'
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the theme was not saved: 1 problem(s), listed under errors","errors":[{"path":"templates.sign-in","message":"The element is not allowed in a template.","code":"element-not-allowed","detail":"main","line":1,"column":1}],"instance":"01a18b55-acab-7d87-a43e-d959d4e1b523"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the theme was not saved: 1 problem(s), listed under errors","errors":[{"path":"templates.sign-in","message":"The message key is not in the catalogue this page is filled from.","code":"unknown-message-key","detail":"login.nope","line":1,"column":10}],"instance":"01a18b55-acf0-78a6-8b4e-ea6edaa4f5da"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the theme was not saved: 1 problem(s), listed under errors","errors":[{"path":"stylesheet","message":"The class is not one of the page’s documented hooks.","code":"unknown-class","detail":"warm","line":1,"column":1}],"instance":"01a18b55-ad64-770f-93cd-d462896a798b"}
{"draft":null,"published":null}
```

### What a stylesheet may name

The refusal above names a class that is not a documented hook. The list of what a
stylesheet may name is a route of its own, the same for every tenant. Its headers
and size, then the count under each key, the pseudo-classes and pseudo-elements,
and the first few names of three of the lists:

```bash
curl -sS -D - -o hooks.json -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/stylesheet-hooks
wc -c < hooks.json | tr -d ' '
jq -c '{version, classes: (.classes | length), page_kind_classes: (.page_kind_classes | length), elements: (.elements | length), tokens: (.tokens | length), pseudo_classes, pseudo_elements}' hooks.json
jq -c '{classes: .classes[:4], page_kind_classes: .page_kind_classes[:3], tokens: .tokens[:3]}' hooks.json
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-adbe-70aa-bc5a-8436e17e2bc0
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1373
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

1373
{"version":1,"classes":18,"page_kind_classes":17,"elements":21,"tokens":33,"pseudo_classes":["hover","focus","focus-visible","active","disabled","checked","first-child","last-child"],"pseudo_elements":["before","after","placeholder"]}
{"classes":["alert","brand","choice","context"],"page_kind_classes":["page-sign-in","page-consent","page-select-account"],"tokens":["--border-strong","--control-height","--ease"]}
```

### Saving a draft, and previewing it

The draft below sets the light palette, a stylesheet that targets the hook
`page-sign-in`, and a template for the sign-in page. `draft.json` is this file:

```bash
cat > draft.json <<'EOF'
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
  "templates": {
    "sign-in": "<div class=\"page-sign-in\"><h1>{{t \"login.title\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"
  }
}
EOF
```

The first draft of a scope needs no `If-Match`. The answer is the whole view, with
the draft's `ETag`:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @draft.json $P/theme
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-ade5-734b-9311-e1ae3f186eb8
cache-control: no-store
etag: "ac0e6a06fac52ca3153ec081fe9c8d49cd108fa7389ce95e6005fc1043c22d90"
content-type: application/json; charset=utf-8
content-length: 2269
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":{"assets":{},"tokens":{"light":{"inkMuted":"#555555","focusRing":"#0044aa","inkPrimary":"#111111","surfacePage":"#fff4e0","borderStrong":"#777777","signalActive":"#ddeedd","signalDanger":"#fde0d0","surfacePanel":"#fffaf0","surfaceSunken":"#f0e6d0","signalActiveInk":"#004400","signalDangerInk":"#802000"}},"templates":{"sign-in":"<div class=\"page-sign-in\"><h1>{{t \"login.title\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"},"stylesheet":".page-sign-in h1 { border-top: 4px solid #0044aa; }"},"published":null,"sources":{"tokens.light":"default","tokens.dark":"default","tokens.font":"default","stylesheet":"default","templates.sign-in":"default","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"tenant_sources":null,"changed":["tokens","stylesheet","templates"]}
```

`draft_sources` says what publishing the draft would give, where `sources` says
what users see now. Here the three pieces the draft sets would come from the
tenant, and nothing is published yet. The preview info says what the preview
shows and why: it is built from the draft (`from`), and the page is drawn from
the tenant's layer (`shown`):

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{published, draft_sources: (.draft_sources | with_entries(select(.value != "default")))}'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/theme/preview/info?kind=sign-in"
```

```
{"published":null,"draft_sources":{"tokens.light":"tenant","stylesheet":"tenant","templates.sign-in":"tenant"}}
HTTP/1.1 200 OK
x-request-id: 01a18b55-ae3f-7985-981f-cdcdc1043c57
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 92
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"kind":"sign-in","from":"draft","shown":"tenant","faults":[],"refused":[],"unfilled":false}
```

The preview is the page itself, filled with sample values. The stylesheet is
inside the document in a `<style>` element, and the response's policy names its
hash in `style-src`, which is how a page with no script and no external resource
still shows the tenant's rules:

```bash
curl -sS -D - -o preview.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/theme/preview?kind=sign-in&scheme=light"
grep -n -E 'stylesheet|page-sign-in|<h1>' preview.html | cut -c1-200
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-ae92-7685-b710-d8f9fb1e977d
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self' 'sha256-1DktTfInWBxB93XYhl/aJU27QE6CYWoUiHFWUlRP63Y='; font-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
referrer-policy: no-referrer
x-content-type-options: nosniff
content-length: 1877
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

8:<link rel="stylesheet" href="/instrument/instrument.css">
11:.page-sign-in h1 { border-top: 4px solid #0044aa; }
15:<main class="page page-sign-in">
17:<div class="page-sign-in"><h1>Sign in</h1><form method="post" action="/tenants/theme-demo/login-actions/authenticate">
```

### Replacing a draft takes its `ETag`

Once a draft exists, a write that sends no `If-Match` is `428` and one that sends
a stale one is `412`, and the draft stays as it was:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @draft.json $P/theme
echo
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -H 'If-Match: "0000"' --data-binary @draft.json $P/theme
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a18b55-aef9-7c31-9fdc-aa08fa005269
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 176
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace the draft theme","instance":"01a18b55-aef9-7c31-9fdc-aa08fa005269"}
HTTP/1.1 412 Precondition Failed
x-request-id: 01a18b55-af41-710e-9091-ea1f7888734f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Fri, 30 Oct 2026 05:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a18b55-af41-710e-9091-ea1f7888734f"}
```

### Publishing

Publishing runs every check again and makes the draft version 1. The draft is
consumed (`"draft":null`), and `sources` now names the tenant for the three
pieces. A stylesheet and a template cannot be proven accessible, so each is a
`warnings` entry, which does not block:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-af95-7554-872a-031cb8cb9da1
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2014
Date: Fri, 30 Oct 2026 05:43:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":null,"published":{"id":"01a18b55-adf8-7cad-b164-a3f0f04d5e25","version":1,"published_at":"2026-10-30T05:43:31.024Z","body":{"assets":{},"tokens":{"light":{"inkMuted":"#555555","focusRing":"#0044aa","inkPrimary":"#111111","surfacePage":"#fff4e0","borderStrong":"#777777","signalActive":"#ddeedd","signalDanger":"#fde0d0","surfacePanel":"#fffaf0","surfaceSunken":"#f0e6d0","signalActiveInk":"#004400","signalDangerInk":"#802000"}},"templates":{"sign-in":"<div class=\"page-sign-in\"><h1>{{t \"login.title\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"},"stylesheet":".page-sign-in h1 { border-top: 4px solid #0044aa; }"}},"sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":null,"changed":[],"warnings":[{"piece":"stylesheet","code":"stylesheet-unverified","message":"A stylesheet can change any colour or hide any element, so its contrast and legibility are not checked; keeping it accessible is the tenant’s responsibility."},{"piece":"templates.sign-in","code":"template-unverified","message":"A template places the page’s parts as its author chose, so its reading order and layout are not checked; keeping it accessible is the tenant’s responsibility."}]}
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b030-7604-b709-c00d0b97f39e
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 171
Date: Fri, 30 Oct 2026 05:43:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a18b55-adf8-7cad-b164-a3f0f04d5e25","version":1,"state":"published","created_at":"2026-10-30T05:43:30.548Z","published_at":"2026-10-30T05:43:31.024Z"}]}
```

### A palette that fails contrast saves, and does not publish

A draft is checked for what it holds, not for contrast. Saving one whose
`inkMuted` is almost the page colour is `200`; publishing it is a `400` that names
the colour (`tokens.light.inkMuted`) and each surface it fails against, with the
ratio. The draft stays, so the author fixes it where it is:

```bash
sed 's/"inkMuted": "#555555"/"inkMuted": "#eeeeee"/' draft.json > low-contrast.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @low-contrast.json $P/theme
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
```

```
200
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the theme was not published: 3 problem(s), listed under errors","errors":[{"path":"tokens.light.inkMuted","message":"Contrast against surfacePage is 1.06:1; 4.5:1 is required.","code":"contrast","detail":"inkMuted/surfacePage"},{"path":"tokens.light.inkMuted","message":"Contrast against surfacePanel is 1.12:1; 4.5:1 is required.","code":"contrast","detail":"inkMuted/surfacePanel"},{"path":"tokens.light.inkMuted","message":"Contrast against surfaceSunken is 1.07:1; 4.5:1 is required.","code":"contrast","detail":"inkMuted/surfaceSunken"}],"instance":"01a18b55-b0f1-71a3-98eb-cdb5c0229de0"}
```

### A second version, and restoring the first

The fix replaces the draft with its `ETag` and changes the rule's colour; the
second publish is version 2, the first goes to `archived`. Restoring version 1
publishes a copy of it as a new version, whole, and leaves the draft alone:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | tr -d '\r' | sed -n 's/^etag: //p')
sed 's/#0044aa; }/#005599; }/' draft.json > second.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" --data-binary @second.json $P/theme
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish | jq -c '{version: .published.version, stylesheet: .published.body.stylesheet, warnings: [.warnings[].piece]}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {version, state}'
```

```
200
{"version":2,"stylesheet":".page-sign-in h1 { border-top: 4px solid #005599; }","warnings":["stylesheet","templates.sign-in"]}
{"version":2,"state":"published"}
{"version":1,"state":"archived"}
```

```bash
V1=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -r '.items[] | select(.version == 1) | .id')
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions/$V1/restore
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {version, state}'
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b330-7113-b120-8dc812a5faea
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1541
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":null,"published":{"id":"01a18b55-b3b0-71f0-b39b-3c9ad884fc67","version":3,"published_at":"2026-10-30T05:43:31.997Z","body":{"assets":{},"tokens":{"light":{"inkMuted":"#555555","focusRing":"#0044aa","inkPrimary":"#111111","surfacePage":"#fff4e0","borderStrong":"#777777","signalActive":"#ddeedd","signalDanger":"#fde0d0","surfacePanel":"#fffaf0","surfaceSunken":"#f0e6d0","signalActiveInk":"#004400","signalDangerInk":"#802000"}},"templates":{"sign-in":"<div class=\"page-sign-in\"><h1>{{t \"login.title\"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"},"stylesheet":".page-sign-in h1 { border-top: 4px solid #0044aa; }"}},"sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":null,"changed":[]}
{"version":3,"state":"published"}
{"version":2,"state":"archived"}
{"version":1,"state":"archived"}
```

### The pieces a draft changes, and discarding it

The tenant now publishes version 3. A new draft that sets a different muted ink and a
different stylesheet differs from it in two pieces, and the theme read lists them in
`changed`; the version users see is untouched. Reading the theme with no draft, and
before this one, lists none:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft: (.draft != null), changed}'
jq '.tokens.light.inkMuted = "#444444" | .stylesheet = ".page-sign-in h1 { border-top: 4px solid #aa4400; }"' draft.json > changed.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @changed.json $P/theme
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft: (.draft != null), changed, published: .published.version}'
```

```
{"draft":false,"changed":[]}
200
{"draft":true,"changed":["tokens","stylesheet"],"published":3}
```

Discarding the draft is `DELETE /theme/draft`, which takes the draft's `ETag` as
`If-Match` like the other writes to it: `428` without one, `412` with a stale one,
`200` with the right one, and the answer is the theme read, now with no draft. The
published version and the versions are what they were:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/draft
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H 'If-Match: "0000"' $P/theme/draft
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" $P/theme/draft | head -c 700; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, changed, published: .published.version}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '.items[] | {version, state}'
```

```
428
412
HTTP/1.1 200 OK
x-request-id: 01a18b55-b4a0-716b-aa70-a432f757ae73
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1541
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":null,"published":{"id":"01a18b55-b3b0-71f0-b39b-3c9ad884fc67","version":3,"published_at":"2026-10-30T05:43:31.997Z","body":{"assets":{},"tokens":{"light":{"inkMuted":"#555555","focusRing":"#0044aa","inkPrimary":"#111111","surfacePage":"#fff4e0","borderStrong":"#777777","signalActive":"#ddeedd","signalDanger":"#fde0d0","surfacePanel":"#fffaf0","surfaceSunken":"#f0e6d0","signalActiveInk":"#004400","signalDangerInk":"#80200
{"draft":null,"changed":[],"published":3}
{"version":3,"state":"published"}
{"version":2,"state":"archived"}
{"version":1,"state":"archived"}
```

A scope with no draft answers `DELETE /theme/draft` with its theme as it is, and
publishing then is the `409` `about:blank#theme-no-draft`. A draft that equals the
published theme (`changed` is empty) is refused with `409`
`about:blank#theme-nothing-to-publish`, since publishing it would add a version
identical to the last. Here the draft is version 3's own content, saved again:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/draft
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @draft.json $P/theme
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft: (.draft != null), changed}'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/publish
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/versions | jq -c '[.items[].version]'
```

```
200
{"type":"about:blank#theme-no-draft","title":"Conflict","status":409,"detail":"there is no draft to publish","instance":"01a18b55-b50d-7867-a050-10a70d90c6b1"}
200
{"draft":true,"changed":[]}
{"type":"about:blank#theme-nothing-to-publish","title":"Conflict","status":409,"detail":"the draft matches the published theme, so there is nothing to publish","instance":"01a18b55-b557-754b-8b82-27a846be7c22"}
[3,2,1]
```

The draft is still there after that refusal, and is discarded the same way:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" $P/theme/draft
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, changed}'
```

```
200
{"draft":null,"changed":[]}
```

### A client's theme, over its tenant's

The client is `portal`, a public client created in the tenant. Its theme view
carries `tenant_sources`: what the tenant's published theme supplies, which is
what the client's pieces fall back to. With no theme of its own, `sources` is
the same list:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{id, client_id, type}'
```

```
{"id":"01a18b55-b5d4-7012-b576-d475b463e7ec","client_id":"portal","type":"public"}
```

```bash
CID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients?client_id_exact=portal" | jq -r '.items[0].id')
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b607-7468-a274-a20c899050eb
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1717
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"client","draft":null,"published":null,"sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"changed":[]}
```

The client's draft overrides one piece, the light palette, and nothing else. The
draft's own sources show the palette from `client` and the stylesheet and the
template from `tenant`, the layer below it, and `tenant_sources` still names the
tenant for all three. The preview info says the page is drawn from the client's
draft (`shown` is `client`):

```bash
jq '{tokens: {light: (.tokens.light + {surfacePage: "#e8f0ff", surfacePanel: "#f4f8ff", surfaceSunken: "#d8e4f8"})}}' draft.json > client-draft.json
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data-binary @client-draft.json $P/clients/$CID/theme | head -c 1200; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme | jq -c '{draft_sources: (.draft_sources | with_entries(select(.value != "default"))), tenant_sources: (.tenant_sources | with_entries(select(.value != "default")))}'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients/$CID/theme/preview/info?kind=sign-in"
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b61e-7d06-af2d-296701a464d1
cache-control: no-store
etag: "8fc14f34b3d7337fb14e4637584f9c6750ccd05745daadcff0210c32bb1eb6cc"
content-type: application/json; charset=utf-8
content-length: 2859
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"client","draft":{"assets":{},"tokens":{"light":{"inkMuted":"#555555","focusRing":"#0044aa","inkPrimary":"#111111","surfacePage":"#e8f0ff","borderStrong":"#777777","signalActive":"#ddeedd","signalDanger":"#fde0d0","surfacePanel":"#f4f8ff","surfaceSunken":"#d8e4f8","signalActiveInk":"#004400","signalDangerInk":"#802000"}},"templates":{},"stylesheet":null},"published":null,"sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","t
{"draft_sources":{"tokens.light":"client","stylesheet":"tenant","templates.sign-in":"tenant"},"tenant_sources":{"tokens.light":"tenant","stylesheet":"tenant","templates.sign-in":"tenant"}}
HTTP/1.1 200 OK
x-request-id: 01a18b55-b654-7788-8fae-a9f57dd6ffba
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 92
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"kind":"sign-in","from":"draft","shown":"client","faults":[],"refused":[],"unfilled":false}
```

The client's preview shows its palette (`#e8f0ff`) under the tenant's stylesheet:

```bash
curl -sS -D - -o client-preview.html -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients/$CID/theme/preview?kind=sign-in"
grep -n -E 'page-sign-in|--surface-page' client-preview.html | cut -c1-160
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b66f-7353-9703-4953c04142c5
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self' 'sha256-iutXvhUioEQ5vx0C4gW4CxH0k1cr7GVXWvGWRCjwFyw='; font-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
referrer-policy: no-referrer
x-content-type-options: nosniff
content-length: 1858
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

9:<style>@media (prefers-color-scheme:light){:root:not([data-theme]){--surface-page:#e8f0ff;--surface-panel:#f4f8ff;--surface-sunken:#d8e4f8;--ink-primary:#1111
10::root[data-theme='light']{--surface-page:#e8f0ff;--surface-panel:#f4f8ff;--surface-sunken:#d8e4f8;--ink-primary:#111111;--ink-muted:#555555;--signal-active:#
11:.page-sign-in h1 { border-top: 4px solid #0044aa; }
15:<main class="page page-sign-in">
17:<div class="page-sign-in"><h1>Sign in</h1><form method="post" action="/tenants/theme-demo/login-actions/authenticate">
```

Publishing, the versions, a restore and a reset are the tenant's routes under the
client. Resetting a client leaves it showing its tenant's theme, which its own
view says (`published` is `null`, and `sources` names the tenant again):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme/publish \
  | jq -c '{version: .published.version, sources: (.sources | with_entries(select(.value != "default"))), warnings}'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme/versions
```

```
{"version":1,"sources":{"tokens.light":"client","stylesheet":"tenant","templates.sign-in":"tenant"},"warnings":[]}
HTTP/1.1 200 OK
x-request-id: 01a18b55-b6a1-7b71-969e-457c2504d949
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 171
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a18b55-b62a-7cef-b941-e0bcca0c8b8a","version":1,"state":"published","created_at":"2026-10-30T05:43:32.648Z","published_at":"2026-10-30T05:43:32.754Z"}]}
```

```bash
CV=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme/versions | jq -r '.items[0].id')
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme/versions/$CV/restore | jq -c '{version: .published.version, draft}'
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme | head -12
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$CID/theme | jq -c '{draft, published, sources: (.sources | with_entries(select(.value != "default")))}'
```

```
{"version":2,"draft":null}
HTTP/1.1 200 OK
x-request-id: 01a18b55-b6e4-7ee3-a491-0a920718b7c6
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1717
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"client","draft":null,"published":null,"sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":{"tokens.light":"tenant","tokens.dark":"default","tokens.font":"default","stylesheet":"tenant","templates.sign-in":"tenant","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"changed":[]}{"draft":null,"published":null,"sources":{"tokens.light":"tenant","stylesheet":"tenant","templates.sign-in":"tenant"}}
```

### Images

`logo.png` is a 96 by 32 pixel PNG made for this page. The upload answers `201`
with the stored image's `id`, its `sha256`, the type it was stored as, its size
and the `kind` it was uploaded for; the image is decoded and stored re-encoded,
so `bytes` is the stored size, not the file's:

```bash
file logo.png
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" \
  --data-binary @logo.png "$P/theme/assets?kind=logo"
echo
```

```
logo.png: PNG image data, 96 x 32, 8-bit/color RGB, non-interlaced
HTTP/1.1 201 Created
x-request-id: 01a18b55-b70f-7dba-bbe5-5eddfa18423c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 189
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a18b55-b71f-74f3-a0d3-91c5f90374a8","sha256":"f49c86eb1cd9ab9d6d375c9eca74c13a8dc49208de6ccddefcc1e76be257caba","mime":"image/png","width":96,"height":32,"bytes":144,"kind":"logo"}
```

```bash
ASSET=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @logo.png "$P/theme/assets?kind=logo" | jq -r .id)
```

An admin reads an image back by its id before any public address serves it. The
type is the one it was stored as, with `nosniff` and `no-store`. An id that does
not exist in this tenant is `404`, and one that is not an id is `400`:

```bash
curl -sS -D - -o stored-logo.png -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/$ASSET/content
file stored-logo.png
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/01a18705-0000-7000-8000-000000000000/content
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/not-an-id/content
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b743-7c0a-aba6-9c82a4b6d9ae
cache-control: private, no-store
content-security-policy: default-src 'none'; sandbox
cross-origin-resource-policy: same-origin
x-content-type-options: nosniff
content-type: image/png
content-length: 144
Date: Fri, 30 Oct 2026 05:43:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

stored-logo.png: PNG image data, 96 x 32, 8-bit/color RGB, non-interlaced
404
400
```

A refused upload stores nothing. Two files are made for it: `notimage.png` is twenty
bytes of text with an image name, and `big.png` is 300,000 bytes of zeros, more than
a `logo` may be (256 KiB):

```bash
printf 'this is not an image' > notimage.png
head -c 300000 /dev/zero > big.png
file notimage.png
wc -c < notimage.png
wc -c < big.png
```

```
notimage.png: ASCII text, with no line terminators
      20
  300000
```

Bytes that are no image are `415` `asset-unsupported-type` whatever type the request
declared (here `image/png`). A declared type that is none of the four allowed, or
none at all, is refused with the same problem before the body is read, naming the
declared type as the cause rather than the bytes; and a body longer than the kind
allows is `413`:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" \
  --data-binary @notimage.png "$P/theme/assets?kind=logo"
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/svg+xml" \
  --data-binary @logo.png "$P/theme/assets?kind=logo"
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type:" \
  --data-binary @logo.png "$P/theme/assets?kind=logo"
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: text/plain" \
  --data-binary @logo.png "$P/theme/assets?kind=logo"
echo
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" \
  --data-binary @big.png "$P/theme/assets?kind=logo" | grep -v -E '^(Date|Connection|Keep-Alive)'
```

```
{"type":"about:blank#asset-unsupported-type","title":"Unsupported Media Type","status":415,"detail":"the image is not a PNG, a JPEG or a WebP","instance":"01a18b55-b77f-7f3b-adfd-123926297c7a"}
{"type":"about:blank#asset-unsupported-type","title":"Unsupported Media Type","status":415,"detail":"the declared type is image/svg+xml, not image/png, image/jpeg, image/webp or application/octet-stream","instance":"01a18b55-b78f-7bb6-b6d7-438e6ffa5f12"}
{"type":"about:blank#asset-unsupported-type","title":"Unsupported Media Type","status":415,"detail":"no type was declared, not image/png, image/jpeg, image/webp or application/octet-stream","instance":"01a18b55-b79f-76cd-b436-b50047a292c9"}
{"type":"about:blank#asset-unsupported-type","title":"Unsupported Media Type","status":415,"detail":"the declared type is text/plain, not image/png, image/jpeg, image/webp or application/octet-stream","instance":"01a18b55-b7af-7318-91ef-b9048e693ae0"}
HTTP/1.1 413 Payload Too Large
x-request-id: 01a18b55-b7c0-7e93-a3b0-098eccc31f70
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 150

{"type":"about:blank","title":"Content Too Large","status":413,"detail":"Request body is too large","instance":"01a18b55-b7c0-7e93-a3b0-098eccc31f70"}
```

An image a draft names cannot be deleted: `409` with the first drafts and
versions that name it. A reset deletes the draft and archives the published
version, after which nothing names the image and the delete is `204`:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"assets\":{\"logo\":{\"assetId\":\"$ASSET\",\"alt\":\"Theme Demo\"}}}" $P/theme | jq -c '{draft: .draft.assets, draft_sources: (.draft_sources | with_entries(select(.value != "default")))}'
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/$ASSET
```

```
{"draft":{"logo":{"alt":"Theme Demo","assetId":"01a18b55-b71f-74f3-a0d3-91c5f90374a8"}},"draft_sources":{"assets.logo":"tenant"}}
HTTP/1.1 409 Conflict
x-request-id: 01a18b55-b7ee-7c11-b1b4-801a3534f304
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 254
Date: Fri, 30 Oct 2026 05:43:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#asset-in-use","title":"Conflict","status":409,"detail":"a theme still names the image","errors":[{"path":"theme","message":"named by the draft 01a18b55-b7e0-7998-af3d-c3e7e1a76cde"}],"instance":"01a18b55-b7ee-7c11-b1b4-801a3534f304"}
```

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | jq -c '{draft, published, sources: (.sources | with_entries(select(.value != "default")))}'
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/$ASSET
```

```
HTTP/1.1 200 OK
x-request-id: 01a18b55-b806-7392-8eaa-cddd88c5bae1
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 921
Date: Fri, 30 Oct 2026 05:43:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"scope":"tenant","draft":null,"published":null,"sources":{"tokens.light":"default","tokens.dark":"default","tokens.font":"default","stylesheet":"default","templates.sign-in":"default","templates.consent":"default","templates.select-account":"default","templates.logout-confirm":"default","templates.totp-enrolment":"default","templates.passkey-enrolment":"default","templates.recovery-codes":"default","templates.update-password":"default","templates.required-action":"default","templates.registration":"default","templates.reset":"default","templates.verification":"default","templates.required-actions":"default","templates.authorize-error":"default","templates.email-unverified":"default","templates.logged-out":"default","templates.notice":"default","assets.logo":"default","assets.darkLogo":"default","assets.favicon":"default","assets.background":"default"},"draft_sources":null,"tenant_sources":null,"changed":[]}
{"draft":null,"published":null,"sources":{}}
HTTP/1.1 204 No Content
x-request-id: 01a18b55-b82c-7e19-b693-30be42cc97ff
cache-control: no-store
Date: Fri, 30 Oct 2026 05:43:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

### A background, and the preview's bound

`background.png` is a 640 by 360 pixel PNG made for this page, and a background may
be 1 MiB and 2560 pixels. The upload answers `201` as a logo's does, with `kind`
`background`:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" \
  --data-binary @background.png "$P/theme/assets?kind=background" | jq -c .
```

```
{"id":"01a18b55-b84d-76b4-bd26-bbeff380c7dc","sha256":"c9d7688a6cf8827b7666eb243d6f3abfdfb8a6abc2de5060e485d4159ce134e4","mime":"image/png","width":640,"height":360,"bytes":1233,"kind":"background"}
```

The preview carries the stylesheet and every image the page shows inline, so it has
a bound: past about 2.2 MiB, counting an image once for each place the draft names
it, the answer is `422` `about:blank#theme-preview-too-large` and says by how much.
`noise.png` is 540 by 540 pixels of random colour, which does not compress, and is
under the 1 MiB a background may be; the draft below names it as the background and
as both logos, three places:

```bash
python3 -c '
import os, struct, zlib
w = h = 540
raw = b"".join(b"\x00" + os.urandom(w * 3) for _ in range(h))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
open("noise.png", "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b""))
'
wc -c < noise.png | tr -d ' '
NOISE=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/png" --data-binary @noise.png "$P/theme/assets?kind=background" | tee noise.json | jq -r .id)
jq -c '{mime, width, height, bytes, kind}' noise.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"assets\":{\"background\":{\"assetId\":\"$NOISE\"},\"logo\":{\"assetId\":\"$NOISE\",\"alt\":\"Theme Demo\"},\"darkLogo\":{\"assetId\":\"$NOISE\",\"alt\":\"Theme Demo\"}}}" $P/theme
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/theme/preview?kind=sign-in" | grep -v -E '^(Date|Connection|Keep-Alive)'
echo
```

```
875673
{"mime":"image/png","width":540,"height":540,"bytes":876966,"kind":"background"}
200
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a18b55-b92f-745c-a4f1-9601bc88fd85
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 263

{"type":"about:blank#theme-preview-too-large","title":"Unprocessable Content","status":422,"detail":"the draft's stylesheet and images come to 3508067 bytes once inlined, over the 2271916 bytes a preview carries","instance":"01a18b55-b92f-745c-a4f1-9601bc88fd85"}

```

The draft is discarded, which frees the image, and the image is deleted:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" $P/theme/draft
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" $P/theme/assets/$NOISE
```

```
200
204
```
