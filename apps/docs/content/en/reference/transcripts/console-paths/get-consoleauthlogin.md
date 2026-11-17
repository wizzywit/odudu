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
x-request-id: 01a1e40a-99d5-71e9-96e0-8d51cf664fce
cache-control: no-store
set-cookie: odudu-console-login=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48&nonce=n4P22nIWRyugG5cR5rX9nVVt-OleKFm0DfOCtcrlIko&code_challenge=rQSla7vgAf2zoYQqNOLL7awyoONHK79Quzfr05_N9Z8&code_challenge_method=S256
content-length: 0
Date: Mon, 16 Nov 2026 11:07:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The login cookie's value is the `state` sent to the authorization endpoint:
`<tenant id>.<secret>`. The pending sign-in is stored with the secret's hash,
the PKCE verifier and the nonce. It lasts 1800 seconds, as the cookie's
`Max-Age` says, and every login cookie below says the same: as long as the
tenant's own sign-in lasts by default (`login_ttl_seconds`), since that is
where the time goes. The sections below go on from this `location`.
