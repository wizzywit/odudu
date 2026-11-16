---
title: 'GET /console/auth/login'
description: "The console's sign-in starts here. return_to is where the callback sends the browser afterwards, and must be a /console/ path."
---

# `GET /console/auth/login`

The console's sign-in starts here. `return_to` is where the callback sends
the browser afterwards, and must be a `/console/` path.

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3f8-f3ce-78b1-b0d6-71724acd0984
cache-control: no-store
set-cookie: odudu-console-login=01a1e3f8-ef88-7bd7-af39-bd6085c44bef.vK2hin2snNnTOZZuE7GuUzJcjlQ7exD_5DwhsoRQAFY; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e3f8-ef88-7bd7-af39-bd6085c44bef.vK2hin2snNnTOZZuE7GuUzJcjlQ7exD_5DwhsoRQAFY&nonce=Fee2tib44Tj_TfREZ_ghk6TGYmZG_MTZr3vG9LoU_vc&code_challenge=gR2ROFFsQoi4GLVybUvJiJeZUblwgIos6Mr-vPGzxeM&code_challenge_method=S256
content-length: 0
Date: Mon, 16 Nov 2026 10:48:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The login cookie's value is the `state` sent to the authorization endpoint:
`<tenant id>.<secret>`. The pending sign-in is stored with the secret's hash,
the PKCE verifier and the nonce. It lasts 1800 seconds, as the cookie's
`Max-Age` says, and every login cookie below says the same: as long as the
tenant's own sign-in lasts by default (`login_ttl_seconds`), since that is
where the time goes. The sections below go on from this `location`.
