---
title: Sign a user in
description: Send a person to Odudu to sign in and get back tokens your app can trust, with the authorization code flow and PKCE.
sidebar_position: 1
---

# Sign a user in

Your app sends a person to Odudu. They sign in on Odudu's own page. Your app then gets back tokens it can trust. This is the authorization code flow with PKCE, and every client uses it, public or confidential.

The examples use a tenant called `demo`, a single-page app registered as `demo-spa`, and a user called `ada`. Use your own names. Each step shows a trimmed piece of a real run and links to the whole thing.

## 1. Find the endpoints

Ask the tenant for its discovery document. Everything else in this guide comes from it: where to send people, where to swap a code for tokens, and where the signing keys are.

```bash
curl -sS http://localhost:3000/tenants/demo/.well-known/openid-configuration
```

```
  "issuer": "http://localhost:3000/tenants/demo",
  "authorization_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token",
```

These are the first members of the answer. Full transcript: [Path A, discovery](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#1-discovery).

## 2. Make a PKCE pair

Before you send anyone anywhere, make a random secret, the verifier, and its fingerprint, the challenge. Keep the verifier. Send only the challenge.

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')
```

Full transcript: [Path A, /authorize](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#2-authorize).

## 3. Send the person to Odudu

Redirect the browser to the authorization endpoint. Add a `state` you will compare when the person comes back, and a `nonce` that will appear in the ID token.

```bash
curl -sS -D - --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode 'nonce=n-0S6_WzA2Mj' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3197/tenants/demo/protocol/openid-connect/auth'
```

(This run used another port, 3197.) Odudu answers with its own sign-in page, named for your client and the tenant. The `set-cookie` header is how Odudu remembers which sign-in this browser started, for the sign-in's lifetime (thirty minutes by default); you do nothing with it.

```
HTTP/1.1 200 OK
x-request-id: 01a1647b-2c1e-7ca8-a195-91f4799076e0
set-cookie: odudu-sign-in=01a1647b-2c2b-793d-b112-fbeacaf248f2.JXiLxsWqKLuPc5x42YKrEpXHxOrvmO_Rt4EC7SJtKSw; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=1800
content-type: text/html
```

```
<h1>Sign in</h1>
<p class="context">to continue to <bdi>demo-spa</bdi></p>
<p class="tenant"><bdi>demo</bdi></p>
```

Full transcript: [Path A, /authorize](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#2-authorize).

## 4. The person signs in

The person types a name and a password, or uses a passkey. You do nothing while they do. When it works, Odudu sends the browser back to your redirect address with a one-time `code`.

```
HTTP/1.1 302 Found
set-cookie: demo-session=01a1d09d-b8ea-…:-f-lehfJxhKV…; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-device=C74Nzrm4yL83SYBrNJWgWg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=0
location: http://localhost:8080/callback?code=7Dk1_YDCRJAn…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

Check three things before you use the code. `state` must equal what you sent. `iss` must name the Odudu tenant you started with. The code lives for 60 seconds by default and works once.

Full transcript: [Path A, the login POST](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#3-the-login-post).

## 5. Swap the code for tokens

From your server, or from the app for a public client, send the code and the verifier to the token endpoint. A confidential client also proves who it is: see [how a client proves who it is](../concepts/clients.mdx#how-a-client-proves-who-it-is).

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "HyqdGK5v2WV2lTarwqmC…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

The access token is what you send to your APIs. The ID token says who signed in. The refresh token gets new tokens later. The access token here lives 300 seconds. Verify the ID token's signature against the tenant's keys and check its `nonce` before you trust it.

Full transcript: [Path A, /token](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#4-token).

## 6. Ask who signed in

Send the access token to the UserInfo endpoint to read the person's claims.

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```
{
  "sub": "01a0cb07-4e76-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790112846,
  "exp": 1790113146,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0cb0a-5198-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

Full transcript: [Path A, /userinfo](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#5-userinfo).

## A sign-up button

A "Sign up" button in your app is the same request as "Sign in", with `prompt=create` added. Odudu shows the person its registration page instead of the sign-in page. Your app keeps its own `state`, `nonce` and PKCE pair. Once the person has an account and signs in, the code comes back the same way. The tenant must allow self-registration; see [Settings](../admin-console/settings.mdx). Do not send an `id_token_hint` or a `claims` `sub` with it: those name an existing person, and the request is refused.

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=create' \
  'http://localhost:3331/tenants/register-demo/protocol/openid-connect/auth' \
  | grep -iE '^(HTTP|location|set-cookie)'
```

```
HTTP/1.1 303 See Other
set-cookie: odudu-sign-in=01a16990-78a9-7085-a2a8-bbaf1ec6130e.jonCj76UnfEjGF1KyFgF68szQhRj4emANpMttPGP6wI; HttpOnly; SameSite=Lax; Path=/tenants/register-demo/; Max-Age=1800
location: /tenants/register-demo/login-actions/registration?return_to=%2Ftenants%2Fregister-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dregister-spa%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8080%252Fcallback%26scope%3Dopenid%2Bemail%26code_challenge%3DE9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM%26code_challenge_method%3DS256%26state%3Dxyz123%26nonce%3Dabc123%26prompt%3Dlogin
```

(This run used another port, 3331.) The cookie is how Odudu remembers the request, as on the sign-in page. The registration page carries your request as `return_to`. When the person has made their account, the page sends them to sign in with it, and the code reaches your `redirect_uri` with your `state`. Send `prompt=create` on its own; combined with another `prompt` value it is refused. A tenant that does not allow self-registration answers `invalid_request` at your `redirect_uri`, and its discovery document lists `prompt_values_supported` without `create`.

Full transcript: [Self-registration, starting at the registration page](../reference/transcripts/request-paths/self-registration.md#starting-at-the-registration-page).

## Run a finished app

Everything above is what an app does for you. To see it done in code, run [the single-page app example](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), which signs a person in from the browser, or [the web app example](https://github.com/wizzywit/odudu/tree/main/examples/web-app), whose server keeps a secret. Each README says how to run it against your stack.

## Where to go next

- [Refresh and end a session](./refresh-and-end-a-session.md) keeps the person signed in and signs them out.
- [Read a refusal](./read-a-refusal.md) explains what each error means.
- The whole flow, with every header, is in [Path A: authorization code with PKCE](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md).
