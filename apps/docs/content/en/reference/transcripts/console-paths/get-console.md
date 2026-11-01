---
title: 'GET /console/'
description: "The logout's 302 lands on the console shell. Every path under /console/ that neither the API nor the sign-in routes claim answers the shell, with…"
---

# `GET /console/`

The logout's `302` lands on the console shell. Every path under `/console/`
that neither the API nor the sign-in routes claim answers the shell, with
the gateway's CSP, and each hashed asset the shell names is served
`immutable`. The shell holds Instrument's tokens, the app frame, the session
gate and the sign-in flow. Each area is a chunk of its own, fetched when its
route is first opened, which is why the shell names only the entry, the
chunks every page needs, and their stylesheets.

This section runs on a stack of its own, on `http://localhost:3187`. The shell
reads no cookie, so none is sent.

```bash
curl -sS -D - http://localhost:3187/console/
```

```
HTTP/1.1 200 OK
x-request-id: 01a17b06-88ae-72fc-a5a2-618dc711c99a
content-type: text/html; charset=utf-8
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' 'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-length: 1340
Date: Tue, 27 Oct 2026 01:43:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Odudu console</title>
    <link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/instrument/favicon.ico" sizes="48x48" />
    <link rel="apple-touch-icon" href="/instrument/apple-touch-icon.png" />
    <script type="module" crossorigin src="/console/assets/index-B_gp_lAo.js"></script>
    <link rel="modulepreload" crossorigin href="/console/assets/rolldown-runtime-XKyaHtl9.js">
    <link rel="modulepreload" crossorigin href="/console/assets/zod-DHmueAjU.js">
    <link rel="modulepreload" crossorigin href="/console/assets/PageHeader-CuIBynQq.js">
    <link rel="modulepreload" crossorigin href="/console/assets/useUrlSearch-_9IgUZW8.js">
    <link rel="modulepreload" crossorigin href="/console/assets/PageNotFound-cwf46VQb.js">
    <link rel="modulepreload" crossorigin href="/console/assets/json-4gqhr5jJ.js">
    <link rel="stylesheet" crossorigin href="/console/assets/PageHeader-D3NRoIlr.css">
    <link rel="stylesheet" crossorigin href="/console/assets/PageNotFound-Ba3tLDjP.css">
    <link rel="stylesheet" crossorigin href="/console/assets/index-CWA91DWN.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

The hashed file names in this block, and the sizes in the two responses
below, belong to the build that ran. Every build changes them, so nothing on
this page depends on them and nothing here asserts them.

The two style hashes are React Aria's own injected `<style>` elements —
`usePress`'s pressable style and, on iOS WebKit only, `usePreventScroll`'s
`overscroll-behavior: contain` rule — recomputed from the installed react-aria
by a test. The stylesheets are Instrument's tokens and fonts and the shared
pieces' styles, built and hashed like any other asset.

```bash
curl -sS -D - -o /dev/null http://localhost:3187/console/assets/index-B_gp_lAo.js
```

```
HTTP/1.1 200 OK
x-request-id: 01a17b06-88d1-7005-a6c4-2ad0d430cd86
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
x-content-type-options: nosniff
content-length: 326713
Date: Tue, 27 Oct 2026 01:43:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The entry is the script the shell loads first. The Subjects area's chunk is
not in the shell; it is fetched when `/console/<tenant>/subjects` is first
opened, and is among the largest chunks the build makes:

```bash
curl -sS -D - -o /dev/null http://localhost:3187/console/assets/subjects-LgQxPUcX.js
```

```
HTTP/1.1 200 OK
x-request-id: 01a17b06-9e16-7b63-981a-33e4ab2fc010
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
x-content-type-options: nosniff
content-length: 392705
Date: Tue, 27 Oct 2026 01:43:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```
