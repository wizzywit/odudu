---
title: Protocol in plain words
description: The addresses Odudu serves for sign-in, the parameters each takes, and what it refuses, in plain words.
---

# Protocol in plain words

Odudu speaks OpenID Connect and OAuth 2.0. Every tenant has its own issuer, `https://<host>/tenants/<tenant>`, and every address below sits under it. A library needs only the issuer: it reads the discovery document and finds the rest. The [endpoint table](./generated/endpoints.md) lists every route, and the [guides](../guides/index.md) use these in order.

## The addresses

- **Discovery document**: `/.well-known/openid-configuration`. It names every address below and what the tenant supports.
- **Authorization server metadata** (RFC 8414): `/.well-known/oauth-authorization-server/tenants/<tenant>` on the base address, or `/.well-known/oauth-authorization-server` on a tenant's own domain. The same issuer and endpoints as the discovery document, in the shape an OAuth client that was not written for OpenID Connect reads, with the scopes `mcp:read` and `mcp:write` added. A tenant that is disabled or does not exist answers an empty `404`. See [Authorization server metadata](./transcripts/request-paths/authorization-server-metadata.md).
- **Protected resource metadata** (RFC 9728): `/.well-known/oauth-protected-resource/tenants/<tenant>/mcp` on the base address, or `/.well-known/oauth-protected-resource/mcp` on a tenant's own domain. It names the tenant's MCP URL as the `resource`, the tenant's issuer as its one authorization server, and the scopes `mcp:read` and `mcp:write`, so an MCP client that was given only the MCP URL can find where to sign in. A tenant that is disabled or does not exist answers an empty `404`. See [Protected resource metadata](./transcripts/request-paths/protected-resource-metadata.md).
- **Authorization endpoint**: `/protocol/openid-connect/auth`. It sends the person to sign in, then back to your app with a code.
- **Token endpoint**: `/protocol/openid-connect/token`. It trades a code, a refresh token, client credentials or another token for tokens.
- **UserInfo endpoint**: `/protocol/openid-connect/userinfo`. It returns the claims of the person an access token names.
- **JWKS endpoint**: `/protocol/openid-connect/certs`. It publishes the tenant's public signing keys.
- **Revocation endpoint**: `/protocol/openid-connect/revoke`. It ends a refresh token or an access token.
- **Introspection endpoint**: `/protocol/openid-connect/token/introspect`. It says whether a token is active and what it carries.
- **End session endpoint**: `/protocol/openid-connect/logout`. It signs the person out.
- **Registration endpoint**: `/clients-registrations/openid-connect`. An application registers itself here when the tenant allows it. The discovery document names it only then. A tenant can open it to MCP clients alone: under the `mcp` policy a client must be public, use https or loopback http redirect addresses, ask for no more than `mcp:read` in `scope`, and name no `audience` but the tenant's MCP address, which the response echoes as `audience`. One address may register ten clients an hour, and a refusal for that reason is `429` with `Retry-After`. A `client_name#fr` member (RFC 7591 §2.2) gives the name in a language: it is kept when the tenant offers that language and left out, and not echoed, when it does not, and a tag that is not a language tag, one written twice, or a value that fails the checks `client_name` has is refused with `invalid_client_metadata`. `client_name` itself is held to 256 characters. Other language-tagged members (`client_uri#fr`, `logo_uri#fr`, `policy_uri#fr`, `tos_uri#fr`) are ignored and not echoed.

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

Token exchange lets a service trade a token it holds for another one. Used to act on a person's behalf (delegation), the new token names both the person and the client acting. Used to act as the person (impersonation), it names only the person, and it works only for a client whose **Allow impersonation in token exchange** switch is on. The client must also hold the token exchange grant, under **Grant types** on its **Tokens** tab. Two more limits are off for every client. A public client is refused the grant with `unauthorized_client` until its `token_exchange_allowed_for_public` is on, and an `actor_token` issued to another client is refused until the requesting client's `token_exchange_actor_from_other_client` is on. Both are switches under Token exchange on the client's **Advanced** tab, fields of the client in the admin API and flags of `odudu seed client`. A token that holds `mcp:read` or `mcp:write` keeps one of them, and an `act` claim, through an exchange. A client whose audience ceiling includes the admin API can no longer exchange an ID token without naming another resource, because an ID token is never exchanged for a token for the admin API. [Path D](./transcripts/request-paths/path-d-token-exchange.md) is a recorded run.

A confidential client proves itself in one of the ways its record names: a secret in a Basic header (`client_secret_basic`), a secret in the body (`client_secret_post`) or a signed `client_assertion` with a `client_assertion_type` (`private_key_jwt`). A public client sends only its `client_id`. [How a client proves who it is](../concepts/clients.mdx) compares them.

## Revoke, introspect and sign out

- Revoke and introspect take `token` and the same client authentication as the token endpoint. `token_type_hint` is not read: both kinds of token are tried.
- Sign out takes `id_token_hint`, `post_logout_redirect_uri`, `state` and `client_id`. The address must be registered for the client. A browser that holds a session is asked to confirm, whatever the hint, and the confirmation ends it. The one exception is a client whose `skip_logout_confirmation` setting is on: for a valid `id_token_hint` of its own that belongs to the session the browser holds, it is signed out at once. No hint, a hint for another client or session, and every client with the setting off still ask. When the session ends, each client that asked for it is told through its back-channel or front-channel logout address.

## The me API

A person's own application reads and changes that person's account at `/tenants/<tenant>/me` (at `/me` on a tenant's own domain): `profile`, `credentials`, `sessions` and `consents`. It takes an access token whose audience is the tenant's issuer followed by `/me`, and whose scope holds `me:read`. `me:write` is held only together with `me:read`, so a request for it carries `me:read` along, and at any other audience both scopes are refused with `invalid_scope`. A client asks for the audience with `resource` and must be assigned the scope.

No path or query names a person: the token's own subject is the only one read, so an application cannot ask for somebody else's account. The three lists take `limit` and `cursor`. Nothing secret crosses the API: a credential is listed by type, label and when it was used, never by a hash, key or seed, and a session by when it was last active. [The me API](./transcripts/request-paths/the-me-api.md) shows a sign-in, each read and each refusal.

A token that holds `me:write` also changes the account, through five routes, each for the token's own subject:

- `PATCH /me/profile` amends the profile claims: the members sent are written and `null` clears one. A member that is not a claim, the verification flags included, is refused with `400`, and `username` is accepted only where the tenant has turned on `username_editable`.
- An `email` goes in a request of its own and is answered `202` with `{"email_verification_sent": true}`. The address does not change until the person follows the link mailed to the new address, and whether another account holds it is not told: that case is answered the same and mails nothing. A newer request replaces an earlier pending address. Where the server has no way to send mail the answer is `503` with `mail_unavailable`.
- `DELETE /me/sessions/{id}` ends one of the person's sessions, and `DELETE /me/sessions` ends all the others, a hundred at most in one request: it answers `ended` and `more`, and a client that gets `more: true` repeats it.
- `DELETE /me/consents/{client_id}` withdraws a consent and revokes the grants held under it.
- `PATCH /me/credentials/{id}` renames an authenticator and `DELETE /me/credentials/{id}` removes one. Only a TOTP or a passkey can be removed, never the password. A removal that would leave the person no way to sign in is refused with `409` `last_sign_in_method`, and one that would leave a tenant that requires a second factor without one with `409` `last_second_factor`. Removing the last TOTP revokes the recovery codes that stood in for it.

A new address, a new username, ending all the other sessions, withdrawing a consent and removing an authenticator also need a recent sign-in: the session behind the token must have been signed in within the tenant's `session_freshness_seconds` (300 by default, 30 to 3600, a [setting](../admin-console/settings.mdx) of the tenant). An older sign-in is answered `401` with the challenge of RFC 9470, `WWW-Authenticate: Bearer error="insufficient_user_authentication", max_age="30"`, where `max_age` is the window and `acr_values="2"` is added for the removal of an authenticator by a person who holds a second factor. A client that gets it sends the person through `/authorize` again with that `max_age` (and `acr_values`), and retries the change with the new token: the new sign-in is a session of its own, and the old token stays stale. A token whose session has ended is answered `401` `invalid_token` instead, since signing in again is a new session and not a refresh. This holds for every change, the ones that need no recent sign-in included; a read is not checked against the session. The claims, a rename and ending a single session need no recent sign-in.

A token that carries `act`, one issued to an agent that acts for the person, may read and is refused every write with `403` `agent_not_permitted`, and a token without `me:write` is refused with `403` `insufficient_scope`. Each change leaves an audit row naming the person as the actor, with `via` set to `me` in its detail and the fields changed named but never their values. [The me API: changes](./transcripts/request-paths/the-me-api-changes.md) runs each change, the recent sign-in and its refusals.

## What is not served

Implicit and hybrid flows, `form_post` and `fragment` responses, the password grant, request objects and pushed authorization requests are not served. The [roadmap](../roadmap.md) says which are decisions and which are planned.

## The admin API

The admin API is under `/admin/tenants/<tenant>` and speaks JSON. It takes an access token whose audience is `urn:odudu:params:admin-api`, and a token for any other audience is refused with `401`. You get one by signing in as an administrator through the `odudu-admin` client with the same code flow and PKCE as above. That client is confidential: it authenticates with a signed assertion, and `odudu console assertion --tenant <name>` prints one that lasts a minute. [Getting the token](./transcripts/admin-paths/getting-the-token.md) shows each step. Each operation names the capability it needs, and a caller without it gets `403`. The [admin API reference](./generated/admin-api/index.md) lists every operation.
