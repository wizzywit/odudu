---
title: "The console's discovery and JWKS routes"
description: "Read-only mirrors of the tenant's own public discovery document and JWKS (the request paths' GET…"
---

# The console's discovery and JWKS routes

This page covers `GET /console/api/tenants/{tenant}/discovery` and `GET /console/api/tenants/{tenant}/jwks`.

Read-only mirrors of the tenant's own public discovery document and JWKS
(the request paths document `GET /tenants/{tenant}/.well-known/openid-configuration`
and `GET /tenants/{tenant}/protocol/openid-connect/certs`), reached through
the gateway so the console never needs a transport exception to read them
and the issuer shown is always the one the gateway's own `OduduPort` reads
by inject with the public base's authority pinned — never whatever `Host`
the browser sent. Both require the session `GET /console/api/session`
above shows; a session whose own tenant is neither `system` nor the one
named answers `403`, and a tenant unknown to the server answers `404`.

This section runs on a throwaway stack, on `http://localhost:3080`. Two
administrators: `ada`, `seed admin`'s system-tenant administrator, signed in
through the forced password change the request paths documents; and `grace`,
`odudu-admin:tenant-admin` on a second throwaway tenant, `console-paths-disc`,
signed in the same way `console-paths`' `grace` is above. Neither sign-in is
re-shown here.

A request to `ada`'s own session, with a forged `Host` the gateway never
consults for this call, still answers with the public base's issuer. This block
alone is from a later run, `ada` being that run's `system` administrator and
`$ADA_SESSION` the `odudu-console` cookie of her sign-in on
`http://localhost:3000`, because the discovery document has gained members
since the first run (`private_key_jwt` among the methods `/introspect` and
`/revoke` accept, `ui_locales_supported` and `prompt_values_supported`, and
`mcp:read`, `mcp:write`, `me:read` and `me:write` in `scopes_supported`); the blocks after it are
from the first:

```bash
curl -sS -D - -H 'Host: evil.example' -H "Cookie: $ADA_SESSION" \
  http://localhost:3000/console/api/tenants/system/discovery
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cb48-2cf1-72c6-95f7-e5e05c93e31b
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2456
Date: Wed, 11 Nov 2026 15:44:27 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"issuer":"http://localhost:3000/tenants/system","authorization_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/auth","token_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/token","introspection_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/token/introspect","revocation_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/revoke","userinfo_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/userinfo","jwks_uri":"http://localhost:3000/tenants/system/protocol/openid-connect/certs","end_session_endpoint":"http://localhost:3000/tenants/system/protocol/openid-connect/logout","response_types_supported":["code"],"response_modes_supported":["query"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256","ES256"],"userinfo_signing_alg_values_supported":["ES256","none"],"userinfo_encryption_alg_values_supported":["RSA-OAEP-256","ECDH-ES","ECDH-ES+A128KW","ECDH-ES+A192KW","ECDH-ES+A256KW"],"userinfo_encryption_enc_values_supported":["A128CBC-HS256","A192CBC-HS384","A256CBC-HS512","A128GCM","A192GCM","A256GCM"],"code_challenge_methods_supported":["S256"],"grant_types_supported":["authorization_code","refresh_token","client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"],"token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none","private_key_jwt"],"introspection_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"revocation_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"authorization_response_iss_parameter_supported":true,"claims_parameter_supported":true,"ui_locales_supported":["en"],"prompt_values_supported":["none","login","consent","select_account"],"backchannel_logout_supported":true,"backchannel_logout_session_supported":true,"frontchannel_logout_supported":true,"frontchannel_logout_session_supported":true,"scopes_supported":["address","email","groups","mcp:read","mcp:write","me:read","me:write","offline_access","openid","phone","profile","roles"],"claims_supported":["sub","name","given_name","family_name","middle_name","nickname","preferred_username","profile","picture","website","gender","birthdate","zoneinfo","locale","updated_at","email","email_verified","roles","groups","address","phone_number","phone_number_verified"]}
```

`ada`'s own tenant is `system`, so the same session also reads a tenant
that does not exist, answering `404` rather than `403`:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/no-such-tenant/discovery
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0ea81-1f40-7eee-afb6-44749ad9d15c
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 115
Date: Tue, 29 Sep 2026 00:12:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":404,"type":"about:blank#not-found","title":"Not Found","instance":"01a0ea81-1f40-7eee-afb6-44749ad9d15c"}
```

`grace`'s own tenant is `console-paths-disc`, so her session reads its own
discovery document:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/console-paths-disc/discovery
```

```
HTTP/1.1 200 OK
x-request-id: 01a17b05-e92d-7fbb-a183-86f4fd7574d2
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2508
Date: Tue, 27 Oct 2026 01:42:27 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"issuer":"http://localhost:3080/tenants/console-paths-disc", …}
```

The same session reading `system`'s discovery instead is refused, never
saying whether `system` exists — the same shape a tenant admin's cross-tenant
`/admin/` read is refused with:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/system/discovery
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0ea81-11be-7cc1-8400-879d64e2dd0f
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 105
Date: Tue, 29 Sep 2026 00:12:02 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank","title":"Forbidden","instance":"01a0ea81-11be-7cc1-8400-879d64e2dd0f"}
```

`/jwks` answers the same way, unabbreviated because it is short — here
`grace`'s own tenant's one signing key:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/console-paths-disc/jwks
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea81-2f1d-7b5a-ab99-9fddd047757c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 455
Date: Tue, 29 Sep 2026 00:12:09 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"keys":[{"kty":"RSA","n":"lraNFVOr79JY8qqcZdDshqkjsQSPpd8XmqNT-Zpq65MSgLTfkDmhtrdY6y-xDLyH4SNHCzGIEX5Y_WnNc9egH5as8Q2C7ucd0f2dU6ZoNupSJtcoUmYSkzOwHqLD2NhFEGWbLan0rIrTMZwxuUBAPrnMr6zwiZW9kaISCpP6KuKyulFJnVo7cdRcSWkkfZTvFODJpJeWzZ59YEnVr6yMes-1nQbJWvOVpH4T2dc3CX70PWOoadRFgm2FcwwlyidwdhC7GuNvVbjHajmNU96PgtliVOCDzIH9DLg8koXWCG_ruEQ_ZRgRTm6ndKBalMFUzsSnZ22n8APa1nW9DNYLlw","e":"AQAB","kid":"01a0ea7f-01af-7637-a8b5-093872f1685f","alg":"RS256","use":"sig"}]}
```
