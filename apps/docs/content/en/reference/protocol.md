---
title: Protocol in plain words
description: The addresses Odudu serves for sign-in, the parameters each takes, and what it refuses, in plain words.
---

# Protocol in plain words

Odudu speaks OpenID Connect and OAuth 2.0. Every tenant has its own issuer, `https://<host>/tenants/<tenant>`, and every address below sits under it. A library needs only the issuer: it reads the discovery document and finds the rest. The [endpoint table](./generated/endpoints.md) lists every route, and the [guides](../guides/index.md) use these in order.

## The addresses

- **Discovery document**: `/.well-known/openid-configuration`. It names every address below and what the tenant supports.
- **Authorization endpoint**: `/protocol/openid-connect/auth`. It sends the person to sign in, then back to your app with a code.
- **Token endpoint**: `/protocol/openid-connect/token`. It trades a code, a refresh token, client credentials or another token for tokens.
- **UserInfo endpoint**: `/protocol/openid-connect/userinfo`. It returns the claims of the person an access token names.
- **JWKS endpoint**: `/protocol/openid-connect/certs`. It publishes the tenant's public signing keys.
- **Revocation endpoint**: `/protocol/openid-connect/revoke`. It ends a refresh token or an access token.
- **Introspection endpoint**: `/protocol/openid-connect/token/introspect`. It says whether a token is active and what it carries.
- **End session endpoint**: `/protocol/openid-connect/logout`. It signs the person out.
- **Registration endpoint**: `/clients-registrations/openid-connect`. An application registers itself here when the tenant allows it. The discovery document names it only then. A `client_name#fr` member (RFC 7591 §2.2) gives the name in a language: it is kept when the tenant offers that language and left out, and not echoed, when it does not, and a tag that is not a language tag, one written twice, or a value that fails the checks `client_name` has is refused with `invalid_client_metadata`. `client_name` itself is held to 256 characters. Other language-tagged members (`client_uri#fr`, `logo_uri#fr`, `policy_uri#fr`, `tos_uri#fr`) are ignored and not echoed.

## The authorization request

Send these on the query string, or as a form.

- `client_id` and `redirect_uri` name the client and where to send the person back. The address must match one registered for the client exactly.
- `response_type` must be `code`. Nothing else is served.
- `scope` names what you ask for. It defaults to `openid`. A scope the tenant does not have, or one the client is not assigned, is refused.
- `code_challenge` and `code_challenge_method` are required for every client, and the method must be `S256`. This is PKCE. See [Sign a user in](../guides/sign-a-user-in.md).
- `state` comes back to you unchanged. `nonce` comes back in the ID token. Use both.
- `prompt` takes `none`, `login`, `consent`, `select_account` or `create`. With `none`, no page is shown, and a person who is not signed in gets `login_required`. With `create`, the person is shown the registration page instead of the sign-in; a tenant without self-registration refuses it. `create` goes alone. See [a sign-up button](../guides/sign-a-user-in.md#a-sign-up-button).
- `max_age` is the longest age, in whole seconds, a sign-in may have. An older one asks the person to sign in again. The client's default maximum age applies when the request has none.
- `id_token_hint` is an ID token this server issued. It says which person the request is for.
- `ui_locales` picks the language of the pages, from the tenant's `supported_locales`. Without it a page is shown in the signed-in person's `locale` once the first factor is verified, then the tenant's `default_locale` when it has one, then the browser's `Accept-Language`, then English. Discovery lists the tenant's languages as `ui_locales_supported`.
- `claims` asks for individual claims by name.
- `response_mode` may only be `query`. A `request` or `request_uri` is refused. `display`, `claims_locales` and `login_hint` are accepted and ignored.

A request that names an unknown client or an unregistered `redirect_uri` is shown as a page and never redirected. Every other refusal goes back to your `redirect_uri` with `error` and `state`.

PKCE (Proof Key for Code Exchange) stops a stolen code from being useful. Your app makes a random `code_verifier`, sends only its SHA-256 fingerprint as the `code_challenge`, and sends the verifier itself when it trades the code for tokens. Odudu checks that the two match, so whoever intercepts the code alone cannot redeem it. [Single-page app](../guides/single-page-app.md) shows the steps.

## The token request

Send a form to the token endpoint with a `grant_type`.

- `authorization_code`: send `code`, the same `redirect_uri` and the `code_verifier` that matches your challenge.
- `refresh_token`: send `refresh_token`. Each use returns a new one, and an old one used again ends the whole family. See [Refresh and end a session](../guides/refresh-and-end-a-session.md).
- `client_credentials`: a service signs in as itself. Send `scope`, which may name only the client's own service scopes. See [A service calling a service](../guides/machine-to-machine.md).
- `urn:ietf:params:oauth:grant-type:token-exchange`: send `subject_token` and `subject_token_type`. Add `actor_token` and `actor_token_type` to act on a person's behalf, and `requested_token_type`, `audience` or `resource` to say what you want back.

Token exchange lets a service trade a token it holds for another one. Used to act on a person's behalf (delegation), the new token names both the person and the client acting. Used to act as the person (impersonation), it names only the person, and it works only for a client whose **Allow impersonation in token exchange** switch is on. The client must also hold the token exchange grant, under **Grant types** on its **Tokens** tab. [Path D](./transcripts/request-paths/path-d-token-exchange.md) is a recorded run.

A confidential client proves itself in one of the ways its record names: a secret in a Basic header (`client_secret_basic`), a secret in the body (`client_secret_post`) or a signed `client_assertion` with a `client_assertion_type` (`private_key_jwt`). A public client sends only its `client_id`. [How a client proves who it is](../concepts/clients.mdx) compares them.

## Revoke, introspect and sign out

- Revoke and introspect take `token` and the same client authentication as the token endpoint. `token_type_hint` is not read: both kinds of token are tried.
- Sign out takes `id_token_hint`, `post_logout_redirect_uri`, `state` and `client_id`. The address must be registered for the client. A browser that holds a session is asked to confirm, whatever the hint, and the confirmation ends it. The one exception is a client whose `skip_logout_confirmation` setting is on: for a valid `id_token_hint` of its own that belongs to the session the browser holds, it is signed out at once. No hint, a hint for another client or session, and every client with the setting off still ask. When the session ends, each client that asked for it is told through its back-channel or front-channel logout address.

## What is not served

Implicit and hybrid flows, `form_post` and `fragment` responses, the password grant, request objects and pushed authorization requests are not served. The [roadmap](../roadmap.md) says which are decisions and which are planned.

## The admin API

The admin API is under `/admin/tenants/<tenant>` and speaks JSON. It takes an access token whose audience is `urn:odudu:params:admin-api`, and a token for any other audience is refused with `401`. You get one by signing in as an administrator through the `odudu-admin` client with the same code flow and PKCE as above. That client is confidential: it authenticates with a signed assertion, and `odudu console assertion --tenant <name>` prints one that lasts a minute. [Getting the token](./transcripts/admin-paths/getting-the-token.md) shows each step. Each operation names the capability it needs, and a caller without it gets `403`. The [admin API reference](./generated/admin-api/index.md) lists every operation.
