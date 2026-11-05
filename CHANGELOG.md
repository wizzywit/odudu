# Changelog

All notable changes to Odudu are written here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) as [RELEASING.md](RELEASING.md) describes.

## [Unreleased]

### Added

- Every tenant has two new scopes, `mcp:read` and `mcp:write`, for the clients that will use its MCP endpoint, and a tenant that exists before the upgrade gets them when the server migrates. Neither is given to any client until you assign it. A request for either is refused with `invalid_scope` unless the resource is the tenant's MCP address (its address followed by `/mcp`) or the admin API, at the sign-in request and at the token endpoint for every grant, so a client registered for several audiences must name the MCP address as its `resource`. The consent screen says in plain words what each lets an application do, in English and Arabic, and `odudu seed restore-scopes` creates them again if one is deleted.
- Every tenant has a built-in public client, `odudu-mcp`, for local MCP tools to sign in through: PKCE is required, it holds no secret, and its access tokens are for the admin API. It asks for `mcp:read`, with `mcp:write` optional, and shows each person a consent screen. A tenant that exists before the upgrade gets it when the server migrates, unless the tenant already has a client of that name, which is left alone. Its redirect addresses are `http://127.0.0.1` and `http://[::1]`, and a public client registered with a loopback address and no port is accepted at any port, as RFC 8252 asks of an app that listens on a free one; `localhost`, other hosts and confidential clients are still matched exactly. You can disable `odudu-mcp` but not delete it, and the client ID is reserved. A tenant export carries it, and an import reproduces it.
- Each tenant publishes OAuth 2.0 authorization server metadata (RFC 8414), so a client that knows only a resource can find where to sign in without being told. It is at `/.well-known/oauth-authorization-server/tenants/<name>` on your base address, or at `/.well-known/oauth-authorization-server` on a tenant's own domain, and states the tenant's issuer and the same endpoints as its discovery document. It lists `mcp:read` and `mcp:write` among the scopes, `none` and `private_key_jwt` among the ways a client authenticates, and the signing algorithms `private_key_jwt` accepts. A tenant that is disabled or does not exist answers an empty `404`.
- Each tenant publishes OAuth 2.0 protected resource metadata (RFC 9728) for its MCP endpoint, so an MCP client given only that address can find where to sign in. It is at `/.well-known/oauth-protected-resource/tenants/<name>/mcp` on your base address, or at `/.well-known/oauth-protected-resource/mcp` on a tenant's own domain. It states the MCP address as the `resource`, the tenant's issuer as its authorization server (the same issuer its authorization server metadata states), and `mcp:read` and `mcp:write` as the scopes. A tenant that is disabled or does not exist answers an empty `404`. The MCP endpoint itself is not served yet.
- An access token that carries `mcp:write` lives ten minutes at most, even where the tenant or client sets a longer lifetime (a shorter one still applies), and is issued with no refresh token, so a client holding `mcp:write` signs the person in again to keep writing. `offline_access` asked for beside `mcp:write` is ignored without an error. `mcp:read` follows the tenant's lifetimes as before.
- A tenant can have a public address of its own, such as `login.acme.com`, instead of `/tenants/<name>` under your server's address. Its sign-in pages, the issuer its tokens carry, its cookies and the links in its mail follow that address, and a tenant that does nothing behaves exactly as before. The guide is [Custom domains](apps/docs/content/en/operating/custom-domains.md).
- A tenant proves it owns a host by publishing a DNS TXT record under `_odudu-challenge.<host>`, in the console's new Domains area or through `/admin/tenants/{tenant}/domains`. A tenant registers up to twenty domains and has one as its address; registering claims nothing, and the first tenant to prove a host keeps it.
- Switching a tenant to its domain, and back, from the base address. Sign-in cookies belong to one host, so people sign in again at the new address; sessions at the address left are not ended and resume if the tenant switches back. For one hour, the longest an access token lives, the address the tenant left keeps serving the token, user info, introspection, revocation, key, logout and discovery endpoints, and points sign-in to the new address. The console says how many people a switch hides passkeys from before you confirm it.
- `GET /internal/domain-check?domain=<host>` for your reverse proxy's on-demand TLS question (Caddy's `on_demand_tls { ask }`): `200` for a host Odudu serves, `404` for every other, with no body. Keep it off the public network; it takes no secret.
- A recheck of every verified domain's ownership record, `odudu domains recheck`, which the server also runs every hour. A domain whose record is gone for three passes fails, and a tenant that has it as its address returns to its path address. A resolver outage counts as nothing, and a failed domain verifies again once its record is back.
- `odudu seed domain --tenant <name> --host <host>`, with `--canonical` and `--assume-verified`, which marks a host verified without the DNS proof and refuses to run in production.
- Settings `ODUDU_DOMAIN_RECHECK_ENABLED`, `ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS` and `ODUDU_DOMAIN_RECHECK_FAILURES` for the recheck, and `ODUDU_RETENTION_PENDING_DOMAIN_SECONDS` (seven days) for how long a domain nobody proved is kept. `odudu reap` reports `tenant_issuer_retirements` and `tenant_domains` as well.
- The capabilities `view-domains` and `manage-domains`, and a built-in role for each.
- `odudu reap` reports a new table, `client_metadata_cache`, after `tenant_issuer_retirements`: the Client ID Metadata Documents the server fetched for a tenant, which are deleted once their cache lifetime (one minute to a day) has ended. A tenant keeps at most 1,000 of them; past that, a new one replaces the one unused longest that never completed a sign-in, and is refused if every one has. Nothing fills it until a tenant turns on client metadata documents, so the count is `0` for now.
- A tenant can let an app identify itself with a web address instead of registering first. Turn on the `cimd_enabled` setting (off by default; `odudu seed tenant --name <tenant> --set cimd_enabled=true`, or the settings API) and a `client_id` that is an `https` address is resolved to the Client ID Metadata Document served there. The consent page shows the document's name, the host and port of the address and every redirect address; a redirect address the document does not list is refused. The fetch is limited to five KiB and three seconds, follows no redirect, refuses private and local addresses, and is cached for the document's `Cache-Control` lifetime. A tenant's authorization server metadata states `client_id_metadata_document_supported` while the setting is on. With it off, such a `client_id` is refused like any unknown client. Such a client has no audience and no MCP scope until a tenant policy gives them.
- `odudu reap` reports another table, `cimd_clients`, after `client_metadata_cache`: a client kept from a metadata document is deleted when nobody has resolved its document for thirty days, unless it still holds a refresh token that can be used (or that lapsed within the longest access token's life). A tenant keeps at most 1,000 of them.
- A client that came from a metadata document shows `cimd` as its `registration_origin` in the admin API and the console, and is left out of a tenant export.
- A tenant can open client registration to MCP clients alone. The new `client_registration_policy` value `mcp` lets an agent register itself without a token, as a public client with `https` or loopback `http` redirect addresses, which may ask for `mcp:read` and never `mcp:write`, and whose only audience is the tenant's MCP address. A request that asks for more is refused with `invalid_client_metadata`, a tenant at its `max_clients` refuses as before, and one address may register ten clients an hour on a tenant, and the tenant sixty (`429` with `Retry-After` past either). It also refuses a key set and a logout address. `odudu reap` now deletes a public client that registered itself, under the `open` policy as well as `mcp`, once it is a week old and nobody approved it, signed in through it or holds a grant that has not yet been reaped; it reports them as `dynamic_clients`. A client with an approval (even one the person later withdrew), a recent grant, or a sign-in under way stays. A registration token presented to a tenant on `mcp` is ignored and not spent. Set it with `odudu seed tenant --set`, through the settings API, or in the console under Settings, Client registration, where the switch for client metadata documents (`cimd_enabled`) sits beside it; the tenant export carries both.
- On a tenant whose policy is `mcp`, a client that came from a metadata document is given the MCP address as its only audience and `mcp:read` as an optional scope by the policy, never by what its document says, and loses both the next time its document is resolved if the policy is changed. A document client that authenticates with a key is not given them. When the policy is turned off, no client that came through it is offered the MCP address or `mcp:read` at its next sign-in or refresh, so an existing refresh chain stops carrying them; disable or delete the client to end the chain at once. Neither kind of client is ever given `mcp:write`, even if an administrator assigns it.
- Two settings on each client limit token exchange, both off for every client: `token_exchange_allowed_for_public` lets a public client use the exchange grant, and `token_exchange_actor_from_other_client` lets a client present an actor token that was issued to another client. They are fields of the client in the admin API (changes are audited with their values, and so now are changes to `consent_required` and `token_exchange_impersonation_allowed`, which the trail left out before; a client's `ETag` follows them), they travel in a tenant export and import (a document from before them imports with both off), and `odudu seed client` sets them with `--token-exchange-allowed-for-public` and `--token-exchange-actor-from-other-client`, each needing `--grant-type urn:ietf:params:oauth:grant-type:token-exchange`. The console's client page shows them under Token exchange, beside impersonation. Neither is on for any built-in client, and the built-in admin client refuses a change to either.
- Every admin API `POST` takes an `Idempotency-Key` header, so a client that retries a request that may not have arrived cannot apply it twice. The first call with a key runs; a repeat within 24 hours is answered with the same status, body and `ETag` and is marked `Idempotent-Replayed: true`, without running again or writing a second audit row. A key belongs to one tenant, one route and the caller that first used it: the same key with another request, or from another caller, is refused with `422` (`about:blank#idempotency-key-reused`) and one still running with `409`. A repeat is answered from the record before its `If-Match` is read again. A refusal or failure is not kept, so a retry runs. A tenant holds at most 10,000 keys that have not expired, past which a new key is refused with `429`, and a response over 64 KiB is refused with `422` and undone. The routes that answer with a secret shown once (creating a client, rotating its secret, minting a registration token, issuing a password, importing a tenant) refuse a key with `400` rather than keep the secret; repeat them without one. `PUT`, `PATCH` and `DELETE` ignore the header, being idempotent already, and the OpenAPI document names it on each `POST` that takes one.
- `odudu reap` reports another table, `idempotency_keys`, after `client_metadata_cache`: a key is deleted once its 24 hours have passed.

### Changed

- The audit event for a settings change (`tenant.amend_settings`) now carries a detail: the value `client_registration_policy` and `cimd_enabled` had before and after, so a change to who may register clients can be read from the trail. No other setting is written into it.
- A client that registered itself, or that came from a metadata document, is shown the consent screen on every sign-in until the person approves that exact client, even if its consent setting was turned off or its request names no scope the screen could record. Approving one client never approves another, whatever name it gives itself. Clients created by an administrator or with a registration token are unchanged.
- A tenant on a domain signs its administrators in to the console through the domain; the console itself stays on your base address. The admin API accepts a tenant's tokens while their issuer is its current address or one it left in the last hour, so a machine client has to fetch tokens from the canonical token endpoint, and tokens from the address left stop working when the hour ends. A console session opened before a switch carries on, because the console refreshes its token at the new address. Switching back returns sign-in to the path address, and tokens issued at the domain keep working for the hour. The system tenant is unaffected.
- A tenant has one address at a time. A passkey is tied to the address it was registered at: after a switch it is not offered at the other address, and a switch back brings it back. Password sign-in is not affected, and nothing is deleted.
- A client's redirect addresses, web origins and sign-out addresses do not change when its tenant switches address, and the apps that read a tenant's issuer have an hour to move to the new one. An API that checks a token's issuer locally must accept both for that hour.
- The built-in roles are ten, not eight. A tenant that exists before the upgrade gets the two new roles when you run `odudu console provision` once after it; until then its administrators are refused the domain routes and the console hides Domains.
- **Upgrade note.** Token exchange now refuses a public client unless its `token_exchange_allowed_for_public` is on, with `unauthorized_client` (a public client holds no secret, so reaching the grant proved nothing about who asked), and refuses an actor token issued to another client unless the requesting client's `token_exchange_actor_from_other_client` is on, as an `invalid_request` recorded as an `invalid_grant`. A client that relied on either stops working at the upgrade, and nothing backfills it. The server logs a warning at start naming how many public clients hold the grant with the setting off and the first twenty. To list them all, run `select t.name, c.client_id from client_oidc_config o join clients c on c.id = o.client_id join tenants t on t.id = c.tenant_id where c.type = 'public' and not o.token_exchange_allowed_for_public and o.grant_types @> array['urn:ietf:params:oauth:grant-type:token-exchange']` as the database owner. Set the field on each, with `PATCH` in the admin API, or register the client that way with `odudu seed client`. An actor token the requesting client was itself issued, and an exchange by a confidential client with no actor, are unchanged.
- A token exchange or a refresh that would turn a token holding `mcp:read` or `mcp:write` into one holding neither is refused with `invalid_scope`: such a token reaches the admin API as an agent, and one without the scope would have reached it as the person. An exchange of such a token that keeps a scope also keeps an `act` claim, the one it carried or the requesting client's. An exchange can no longer ask for more scope than the token it was handed holds, where it used to be bounded by the grant behind the token.

### Fixed

- A back-channel logout that is retried carries the time of the retry, with the lifetime it was minted with, so a receiver no longer refuses a retry for the age of the first attempt.

### Security

- A request is served as a tenant only through a verified domain row. A host with no verified row selects no tenant and is routed as before, so registering a name cannot blank it; a verified host that is not live gets one bare refusal on every path.
- `X-Forwarded-Host` is read only when `ODUDU_TRUST_PROXY` is on, and then from its last entry, the one your proxy appended, never one a client could have written ahead of it.
- Hosts are refused by their folded spelling, so a Unicode dot or a fullwidth letter does not walk past the refusal of your own host, `localhost` or an IP address.
- Verifying a domain is limited: a tenant looks a host up at most once every 30 seconds and makes ten lookups a minute. The limits are per process.
- A domain whose owner lost it stops serving the tenant's sign-in: the recheck fails it, and the tenant falls back to its path address.
- Mail links are written from the tenant's address, never from the request's `Host`.
- A public client that held the token-exchange grant could use it with any valid actor token, another client's included, because the token endpoint asks a public client for no secret. It is refused unless an administrator allows it, and an actor token must belong to the client presenting it unless that client is allowed otherwise.

## [0.1.0-rc.6] - 2026-11-03

The sixth release candidate. Odudu has had no independent security review.

### Changed

- The admin console's and the documentation site's source is reorganised into the folder layout the contributor documentation describes, with checks that keep it so. Nothing a person sees or calls changed: no route, request, wording or setting.

### Fixed

- Staging a signing key that the server refuses for the algorithm alone now shows the server's reason under the Algorithm control; before, nothing appeared beside the button.

## [0.1.0-rc.5] - 2026-11-01

The fifth release candidate. Odudu has had no independent security review.

### Added

- Every page the server shows, and its mail, can wear a tenant's theme and a client's branding: a light and a dark palette, a font, a logo, a dark logo, a favicon, a background image, a stylesheet and page templates. A client's pieces override the tenant's one piece at a time.
- A Branding area in the admin console, and a Branding tab on each client: a live preview in a sandboxed frame, a draft that is published as a numbered version, up to twenty versions kept, and Revert, Discard and Restore. On a phone the preview is a strip that opens as a sheet.
- Two administrators editing the same message override or theme see what changed and choose Keep mine or Take theirs, instead of overwriting each other.
- Pages and mail in English and Arabic, chosen per tenant, with the tenant's own wording for any message.
- Mail wears the tenant's logo and colours, and a client's over them when the sign-in began in that client, in a light and a dark look. The Email page can send a test mail as any client.
- Documentation for tenant and client branding, with a picture for each step in light and dark.

### Changed

- The admin API authenticates every request that carries a body before it reads the body, so an unauthenticated caller can no longer make the server buffer and validate a large body.
- A client's default scopes are listed in one fixed order, with `openid` first.

### Security

- Templates and stylesheets are checked before they are saved and again when served: a stylesheet cannot hide a needed part of a page, shrink it, wash it out or remove the focus outline, and a template cannot add its own form or script. Uploaded images are re-encoded, and brand and asset responses carry a sandboxing content security policy.
- A message override of the consent heading must keep the client's name.
- Every automatic message carries `Auto-Submitted: auto-generated`.
- The test mail takes one recipient, is rate limited, and says nothing of a failed relay's own text.

## [0.1.0-rc.4] - 2026-10-27

The fourth release candidate. Odudu has had no independent security review.

### Added

- Pages measured on every change against Core Web Vitals and Lighthouse budgets, so the documentation and the landing page stay fast.
- The landing page shows the pages people see when they sign in, and says what is planned for agents and branding.

### Changed

- Logout shows every front-channel logout frame before it redirects to a matched post-logout address.
- Code blocks in the documentation are coloured when the site is built, and read well in both themes.
- A stable tag must point at a commit on `main`, and `latest` moves only to the newest stable release.
- Every GitHub Action in the workflows is pinned to a commit, and Dependabot waits two days before it proposes a version.

### Fixed

- A password reset finds the account whatever the case of its address.
- Two sign-ups with the same address at the same moment can no longer both succeed.
- Failures are logged with their message and stack, and a verification form that failed now shows its page.

### Security

- A mailed link that sets a password now ends every session and token the person had, and proves the address.
- When an address is verified or changed, the account is no longer treated as self-registered. A reset removes authenticators and recovery codes only on an account that registered itself and was never verified.
- Logout tokens now name the address the request came to, and a server in production refuses to start when `ODUDU_TLS` and the `https` or `http` of the public base address disagree.

## [0.1.0-rc.3] - 2026-10-24

The third release candidate. Odudu is not production ready: it has had no security review.

### Changed

- Dependencies are updated across the server, the console, the examples and the base images, including nginx and tsup.
- Dependabot opens grouped pull requests and leaves Node major versions to a manual yearly move.

### Fixed

- A flaky registration test and two lint findings that newer tooling raised.

## [0.1.0-rc.2] - 2026-10-23

The second release candidate. Odudu is not production ready: it has had no security review.

### Added

- The documentation site is published on GitHub Pages, at https://wizzywit.github.io/odudu/.
- The contributor license agreement is approved and checked on pull requests. Contributors outside the allowlist sign by comment.

### Changed

- The README and the pages say release candidate where they said not ready.
- The quick start downloads the compose file of this candidate.
- Dependencies are updated: fastify, drizzle-orm, jose, prettier, libphonenumber-js and react-query, and vite in the example.
- CI retries the browser install, and updates the GitHub Actions cache.

### Security

- Dependency updates bring in the upstream fixes of the packages above.

## [0.1.0-rc.1] - 2026-10-23

The first release candidate. Odudu is not production ready: it has had no security review.

### Added

- A container image on `ghcr.io/wizzywit/odudu`, for amd64 and arm64, signed, with a list of its contents and a record of how it was built.
- A quick start in one command: `docker compose up -d` starts Postgres and Odudu, makes the database roles and the first administrator, and prints a one-time password.
- The `odudu` command in the image: `odudu init`, `odudu help` and `odudu --version`.
- The documentation, served by the server at `/docs/` and published as a site: a quick start, guides, concepts, a tour of the console, operating and reference pages.
- Four small example apps that sign in with Odudu: a web app, a single-page app, an API and a machine-to-machine client.
- A sign-up button: an app sends `prompt=create` to open the registration page, and discovery lists `prompt_values_supported`.
- A hand-tested guide to signing in to WordPress.
- Sign-in pages, error pages and mail in one shared look, with their text in message catalogues.
- A language chosen for each page from `ui_locales` and the browser's `Accept-Language`.
- Sign-in with the authorization code flow and PKCE, refresh tokens, client credentials, token exchange and single sign-on.
- Many tenants on one server, each with its own people, clients, keys and settings.
- Passwords, passkeys, authenticator codes and recovery codes.
- An admin API and an admin console, and an audit trail of every change and sign-in.

### Changed

- Password rules follow NIST SP 800-63B-4.
- One setting now decides the lifetime and shape of every cookie the server sets.
- Built-in scopes can be deleted, by typing their name, and restored.
- The issuer in tokens, discovery and logout is the configured `ODUDU_PUBLIC_BASE_URL`, never a request's `Host` header.
- A password reset ends every session and token the person had.

### Security

- Base images are pinned by digest, and a test keeps them so.
- Registering with an address that is already taken no longer says that it is taken, when email verification is on.
- Cookies are `Secure` and `__Host-` prefixed under `ODUDU_TLS`, from one setting; before, the session cookie ignored it.
- Characters that change the direction of text are refused in names and usernames.

[Unreleased]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.6...HEAD
[0.1.0-rc.6]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.5...v0.1.0-rc.6
[0.1.0-rc.5]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/wizzywit/odudu/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/wizzywit/odudu/releases/tag/v0.1.0-rc.1
