---
title: Roadmap
description: What Odudu does today, what comes next and in what order, what is planned for later, and what it will never do.
---

# Roadmap

You are deciding whether Odudu does what you need, today or soon. This page answers in one screen: what you can use now, what is being built next, what is planned after that, and what Odudu has decided not to do. Odudu is built in phases, and the table that orders them is section 11 of
[the design spec](https://github.com/wizzywit/odudu/blob/main/docs/superpowers/specs/2026-09-10-odudu-design.md).
A paid, hosted service beside the open-source server is planned and has no date
([ADR 0042](https://github.com/wizzywit/odudu/blob/main/docs/adr/0042-distribution-licensing-and-the-paid-boundary.md));
nothing on this page depends on it.

| Today                                                                                                                                                                       | Next, in this order               | Later                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| Sign-in and tokens, many tenants, passwords, passkeys and recovery codes, self-service, theming and branding, an admin API and console, an audit trail, an MCP server, SDKs | A localized console, agent access | Brokering, LDAP and SCIM, SAML, authorization services, extensibility, many instances, FAPI |

## Shipped

Everything here works in the latest stable release, which the quick start installs. Where a change is on `main` and not in a release yet, the changelog says so.

### Sign-in and tokens

- The authorization code flow with PKCE, always required, with discovery, signing keys, user info, introspection and revocation for every tenant.
- Refresh tokens that rotate, a stolen one caught on reuse, and offline access.
- Client credentials, and token exchange for acting on someone's behalf.
- RP-initiated logout with back-channel logout delivered to the apps that registered. Front-channel logout frames are shown on every logout; when the request names a matched post-logout redirect, the browser is sent there once the frames have loaded.
- Single sign-on across the apps of one tenant, through one Odudu session.
- "Remember me" and several sessions per browser, consent, and client registration by hand or by an app itself with a registration token.
- Client authentication by secret, by signed assertion (`private_key_jwt`), by mutual TLS (`tls_client_auth`, when a proxy forwards the certificate and `ODUDU_TRUST_PROXY` is on), or by nothing for a public app.

### Many tenants

- Any number of tenants on one server, each with its own people, clients, keys, settings, sign-in flow and mail relay, kept apart by the database itself.
- A public address of its own for a tenant, a custom domain such as `login.acme.com`. The tenant proves it owns the host with a DNS record, and your reverse proxy asks Odudu whether a host is registered, so it can get the certificate on demand. The issuer, the cookies, the passkeys and the links in mail follow the address. Switching is safe in both directions: people sign in again at the new address, the old address serves what was already issued for an hour and then nothing, a client's redirect addresses do not change, and a tenant can go back to its path address whether or not it still holds the domain. A domain whose record disappears is failed by a recheck and its tenant falls back. Odudu does not issue the certificates ([custom domains](operating/custom-domains.md)).
- Gap-free signing key rotation, and export of a tenant to a file and import as a new tenant.
- Built-in scopes, like any other, can be deleted after typing their name, and restored.

### Credentials and second factors

- Passwords with a policy and lockouts, a list of common passwords that may not be chosen, passkeys, and a one-time password from an authenticator app.
- Recovery codes: ten per person by default (8 to 16 per tenant), shown once, offered again when the last is spent, revoked as a set when the last authenticator goes.
- Self-registration, email verification and password reset, each switched on per tenant, and required actions you set on a person. An app can send a person straight to the registration page with `prompt=create`. Registering with an address that is taken does not say so when verification is on, and a reset ends every session and token the person had. Where an account registered itself and nobody verified the address, it also removes the authenticators and recovery codes on it. With **Verify email addresses** on, a reset link goes only to a verified address, and an administrator's change of an address is held until the person confirms it by mail.

### Admin API and console

- An admin API of more than a hundred operations, each checked against the capability it needs on every request.
- An admin console with a page for every area ([the tour](admin-console/tour.mdx)).

### Theming, branding and languages

- Every page the server shows renders in a tenant's theme and a client's branding. A tenant sets its colours and font, a logo, favicon and background image, one stylesheet and one page template per page kind, and a client overrides any of them piece by piece over the tenant's. A theme is drafted, previewed on the real page, published as a version, and restored or reset, in the Branding area of the console and through the admin API.
- Mail wears the tenant's published logo and colours, and the client's over them when the sign-in began in that client. Mail never takes a stylesheet or a template, and a test message shows the result.
- Logos, favicons and background images are uploaded to Odudu and served from its own address, as PNG, JPEG or WebP only.
- A tenant chooses its languages, a default and its own wording for any page or mail, and a client's name and a scope's text can be given in each language. Arabic is the right-to-left language shipped; its wording is a draft that a reader of Arabic has yet to review.
- Sign-out asks for confirmation by default, and its form's fields are bound into the anti-forgery token. A client can opt out of the confirmation, and the console's own client has.

### An MCP server and agent access

- Every tenant serves an MCP endpoint at `/tenants/<name>/mcp`, or at `/mcp` on a tenant's own domain. An AI agent reaches 64 tools that read what the admin API reads (two of them, `list_tenants` and `count_tenants`, only for a system administrator's agent), as the person who signed in and held to the capabilities that person has, and every call is recorded in the audit trail as an agent acting for its owner. Twelve more tools, only on a token that holds `mcp:write`, change the descriptive text of a client, scope, role or group, change the tenant's display name and languages, set or clear the wording of a sign-in page message, save a draft of a theme that only a person can publish, and make a role, group or scope that grants nothing (no tool makes one a default, gives it to anyone or changes what it releases). Publishing, restoring, discarding and resetting a theme are not offered, and a theme draft that a tool replaces cannot be put back from the audit trail, which keeps digests of what changed and not its text.
- The sign-in an MCP client needs: protected resource and authorization server metadata, dynamic registration for public clients under a tenant's `mcp` registration policy, client ID metadata documents, the `mcp:read` and `mcp:write` scopes, and a write token that lives ten minutes, is never refreshed and is asked about at every sign-in. The MCP Inspector and the TypeScript SDK's client run against it on every server change; Claude and Cursor are documented in [Connect Claude](guides/connect-claude.md) and [Connect Cursor](guides/connect-cursor.md). On 6 November 2026 the owner ran Claude Code 2.1.319 and Claude Desktop 3.6556.2 against a local instance and reported working the reads and the two writes of that release; the tools added since, the claude.ai connectors, Cursor, and `odudu mcp` on Windows and Linux have not been run in a real client.
- `odudu mcp`, the tools that read and the five that amend text, over standard input and output for a desktop client (the three that create a role, group or scope, the two that set or clear a message override and the two that save a theme draft are offered only by the tenant's MCP endpoint, which counts them), signing in a person through the browser or using a service account's key, and a built-in `odudu-mcp` client in every tenant for it. A guide, [Protect an MCP server](guides/protect-an-mcp-server.md), walks through the endpoint's challenge, metadata, registration, sign-in and calls.
- An `Idempotency-Key` header on the admin API's creates and other actions that are not idempotent, so a retried request does not act twice.
- A client gets a service account only while it holds the `client_credentials` grant, when it is created or when the grant is switched on, and loses it when the grant goes. The exception is a confidential client without the grant whose account something still named at an upgrade: that account stays attached, with its roles, and switching the grant on reuses it with those roles as they were. The [clients page](admin-console/clients.mdx) says how the Service account tab marks such an account as not in use and how to remove it.

### Self-service

- A "me" API at `/tenants/<name>/me` (at `/me` on a tenant's own domain), where a signed-in person reads and changes their own profile, credentials, sessions and consents with their own access token, held to the `me:read` and `me:write` scopes and to an audience of its own. Changes that could lock a person out or hand the account over need a recent sign-in, and an older one is answered with the RFC 9470 challenge; removing the last way to sign in or the last second factor of a tenant that requires one is refused. A new email address takes effect only when the person follows the link mailed to it.
- Application-initiated actions: an application sends a signed-in person to `/authorize` with `action` set to change a password, set up an authenticator app, register a passkey, make recovery codes, verify an address or update a profile, and the person lands back at the application with `action_status`. A client may start only the actions its `allowed_actions` setting lists, and one that may needs `me:read` to read the outcome. A link an administrator mailed can return the person to an application the same way.
- Recovery codes can be replaced before the set is spent, once an hour while any remain, and the "me" API says when fewer remain than a tenant's `recovery_code_warn_below`. A person is told by mail when they change how they sign in, and a password change offers to end the other sessions; a password reset ends them all and offers no choice, because a reset is how an account is recovered. The person is told by mail, at the address on file, when a reset sets their password.
- A tenant sets what its new authenticators are made with (algorithm, digits and period of the one-time password, user verification and resident key of a passkey, the size of a recovery set), a sign-in flow's step can set them for that flow alone, and a tenant can ask every person to register a passkey. What was enrolled keeps what it was made with, so no change strands anyone.
- A tenant holds up to 20 named sign-in flows, and a client names the one it runs; it follows the tenant's default when it names none. A tenant also chooses three more required actions (verify the address, update the profile, accept the terms) and refuses a new password that is known from breaches.
- A session is shown against the browser it was opened on, in the admin API and the console. A person whose verification link was used or has expired asks for a new one from the page that says so, and the page a verification or registration link opens names the address and the tenant before its button changes anything. `odudu reconcile-accounts` folds accounts that hold one address apart from its case; a unique index on the address, built by a migration once none remains, stops a new one.

### Agent identity

- A client marked as an agent that exchanges a person's token starts a run of its own: `sub` stays the person and `act.sub` is the run. A run can start runs under it, each narrower than its parent, ending no later than it or the person's session, and no deeper than `agent_max_delegation_depth`, which is 3 unless a tenant changes it. [Agents](concepts/agents.mdx) explains the model and [Delegate to an agent](guides/agent-delegation.md) runs it.
- `may_act` is written into a person's access token from the sign-in client's `delegated_actors` and from the person's own delegations, kept on the grant, and held when the refresh token is the subject of an exchange.
- Ending a grant ends every grant exchanged from it and every run rooted there, in one transaction, and an administrator can end a run and everything it started from the console's **Agents** area.
- An agent's writes are counted against the sign-in's allowance, the share of a run and a daily window for each person and agent client, in one step, so calls made together cannot overspend. Nine `agent_*` tenant settings hold the limits.
- CIBA in poll mode: an agent client asks a named person to approve, polls the token endpoint, and the person answers on a page only they can open. No credential a client holds can approve, and a request for a person who does not exist is answered as one for a person who does.
- A person lets an agent client act for them through the "me" API, with a scope ceiling and a lifetime of up to 90 days. Withdrawing a delegation does not end runs already started.

### SDKs

- Eight npm packages under the scope `@odudu-io` and a Python package, `odudu`, written and tested against Odudu's own server and licensed Apache-2.0, each with its own version and changelog. They are on npm and PyPI at 0.1.0 ([SDKs](sdks/index.md)).
- Signing a person in: `@odudu-io/oidc`, the framework-neutral core (discovery, authorization code with PKCE, refresh, `prompt=create`, logout, a token for the "me" API's audience, and a service's own sign-in with a secret or a `private_key_jwt` key), `@odudu-io/react` (a provider, components and hooks) and `@odudu-io/next` (a server-side session read in the App Router). None shows a sign-in form or handles a password: each sends the person to Odudu's own pages.
- A backend-for-frontend, `@odudu-io/bff`, the pattern RFC 10017 recommends for a browser app: the tokens stay on the server, the browser holds one `__Host-` cookie, and a proxy adds the token to calls to the APIs the app lists. [Backend for frontend](concepts/backend-for-frontend.mdx) says what it stores and refuses; a guide shows [the core without React](sdks/core-without-react.md).
- Checking the access token an API receives: `@odudu-io/node` (with Express, Fastify and `http` helpers) and the Python package's `verify` extra (with FastAPI and Flask helpers), both held to one set of test fixtures, so they give one answer to the same token.
- Typed clients for the admin API and the "me" API, generated from their OpenAPI documents: `@odudu-io/admin-client`, `@odudu-io/me-client` and, in Python, a synchronous and an asynchronous client for both. The "me" API now serves its own OpenAPI document at `/me/openapi.json`, with a reference page for each of its operations, and the admin API's document is smaller, with its shared parts defined once.
- `@odudu-io/mcp-stdio`, `odudu mcp` as a package a laptop installs with `npx`, with no container image and no checkout; the server's own `odudu mcp` command runs on the same code.
- Nine runnable examples under `examples/`, each run in CI against a live stack, and guides for a web app, a single-page app, an API, a service and Claude that teach the packages ([examples](sdks/examples.md)).

### Audit

- Every administrative change, sign-in, refusal, token and credential change is recorded, filterable, exportable as one JSON object per line, and kept for a window you set.

### Running it

- Postgres with migrations applied at boot, health endpoints, one instance with TLS ended in front, with the issuer and every cookie taken from your configuration.
- The container image and the Docker Compose quick start are published with each release, and 0.1.0 is the first stable one. The image is signed, lists its contents, and pulls without signing in.

## Next

These are the phases being built, in the order the design spec gives. Each one says what it brings you.

- **P4h, a localized console.** Every string in the admin console read from a catalogue, a language switch, and right-to-left layouts. Lists sort by the person's language, and error messages are translated. It also sends the failure screen's Error ID to the server, so an operator can find it in the logs. A client's base name and a scope's base text get a language of their own, so a page can mark them.
- **P5c, a console assistant.** An assistant in the admin console that works on a provider and a key the operator supplies, with no provider the console is unchanged. A person asks it to read, explain or draft, and every step is visible. A change it proposes is an approval card the person answers, never the model, so it runs through the same approvals an agent's CIBA request uses. In Act mode it covers every change the console can make except a short list a person does themselves: anything that hands back a secret, anything that reaches an administrator capability, ending every session at once, and the assistant's own settings. Its turns are budgeted, audited and replayable on an activity screen, and a provider is swapped by configuration.
- **P5d, the assistant's secrets and instance writes.** What the assistant leaves to a person today until it can be done safely: a reveal channel that hands a one-time secret to the person without it passing through the model, so it can create a confidential client, rotate a client secret, mint a registration token or issue a password; creating and importing a tenant, which need an instance-write door and cross-tenant Act; changes that reach an administrator capability, once a delegated-administrator rule is decided; and ending every session in a tenant, once that route spares the caller's own.
- **P5b, MCP server: access-changing and destructive tools.** The writes the MCP server withholds because one wrong call changes who can sign in, what a token carries, a secret or a deletion: access-changing writes (grants and mappings, redirect and grant settings, security settings, among them whether the registration form asks for a username, identity fields, publishing a theme, sending mail), credential tools (passwords, client secrets, registration tokens, signing keys, mail relay credentials) and destructive tools (deletes, ending sessions, clearing lockouts, changing keys). Each waits for a confirmation step the agent cannot answer for itself, which is the phase's first design question. The injection suite gains a scenario for each class and a model that is measured. It also decides whether an agent may read the "me" API, and adds a tool that hands the person a link to a self-service action page, since those pages are built for a person alone. A theme image, which no tool uploads today, waits here with any other upload of bytes. The owner decides whether a theme draft an agent replaces is kept as a version a person can restore.

An application can adopt Odudu with every session endable and the account lifecycle in the person's own hands. What an operator still needs before running it in production is P11 and P12 below.

## Later

Placed on a phase, in order, and not started. Each line names the phase that will do it.

- **P6, identity brokering.** Sign in with Google or another upstream OpenID Connect provider. A person is created on first sign-in, with a decision on linking accounts.
- **P7, user federation and inbound provisioning.** LDAP-backed sign-in, SCIM 2.0 inbound provisioning, and moving more than the 10,000 subjects a tenant export carries; an export refuses a tenant above that size and names this as the way. A tenant moved by export and import also takes its published theme, its clients' themes and the images they use, which the file leaves out today. An export is read as one consistent snapshot, so a tenant edited while it is exported still imports. Usernames that look alike are refused.
- **P8, SAML 2.0.** Odudu as a SAML identity provider.
- **P9, authorization services.** Policy evaluation and UMA 2.0, and a resource server as a first-class thing, including who may introspect a token.
- **P10, extensibility.** Third-party providers loaded without a rebuild. A tenant can choose which claim mappers a scope carries but cannot add a new mapper, and an `EventListener` delivering audit events to a SIEM or a webhook belongs here: today only the admin API and the console read the trail.
- **P11, many instances and performance.** One instance only today, because migrations run at boot with no lock and the throttle, the per-address mail limit and the limits on registration and reset links, and the MCP endpoint's request limits, live in one process. Also a deadline for the two outbound lookups on `/token` and `/userinfo`, a documented p99 for both, and a metrics endpoint. Upgrades run in place: a migration runner outside Drizzle's transaction builds indexes concurrently and backfills in batches. Audit events are partitioned by month so retention drops a partition, and deleting a tenant becomes chunked and resumable. A Helm chart or Kubernetes manifests come with it.
- **P12, operational readiness.** Secrets read from somewhere other than the process environment, written backup and restore guidance proven by a restore, and a start-up check that the serving role is neither a superuser nor able to bypass row-level security. Odudu also moves to the next even-numbered Node LTS release by hand, once a year, after a full CI run; Node 26 is the first.
- **P13, FAPI 2.0 and the deferred grants.** Pushed authorization requests (PAR), so request objects are refused until then; DPoP and mTLS-bound tokens; the device authorization grant; `client_secret_jwt` and `self_signed_tls_client_auth` client authentication; and a requested `acr_values` that forces re-authentication, which is accepted and ignored today. A client can read, change and delete its own registration (RFC 7592).
- **P14, SDK breadth and headless sign-in.** More platforms: Vue, Svelte and Angular bindings; native mobile on iOS, Android, Flutter and React Native, using the system browser as RFC 8252 requires; and token verifiers for Go, Java, .NET, PHP and Ruby. Headless sign-in components, which need a flow API the server does not have, so every sign-in page stays server-rendered until it does. An agent library for delegation, covering token exchange and `act` chains, now that their shape is fixed. A session store for the backend-for-frontend package that several instances share, which the package leaves to the app today.

**Smaller capabilities, each placed on a phase**

- **custom subject attributes and a declarative user profile**: P7.
- **fine-grained admin permissions**: P9.
- **per-client dedicated mappers**: P10.
- **a metrics endpoint**: P11.
- **key import, encryption keys and scheduled key rotation**: P12.
- **an audit trail the serving role cannot rewrite, signed or chained**: P12.
- **client registration policies and client policies**: P13. The MCP server added one policy of its own, `mcp`, and nothing more general.
- **admin impersonation**: P13, with its own threat model.

## Decided against, and why

These are choices, not gaps. Each names the decision.

- **PKCE is mandatory, with no opt-out** (ADR 0016). An app that cannot do PKCE cannot use Odudu.
- **Only `response_type=code` and `response_mode=query`** (ADR 0016). OAuth 2.1 removes the implicit grant, so the implicit and hybrid flows are out by design.
- **No resource owner password credentials grant**, a decision: OAuth 2.1 removed it and it is not coming back.
- **`display`, `claims_locales` and `login_hint` are accepted and ignored** (ADR 0043 for the locale one). The specification asks only that they not cause an error. `ui_locales` is honoured.
- **`resource` is validated against the client's registered audiences and not refused for a query component**, a decision: the registered list is what bounds the value.
- **No aggregated or distributed claims**, a decision: the specification makes them optional.
- **A person's password is not chosen in the console or the admin API**, a decision: a new subject owes a password change and the console issues a one-time password, so no operator handles a password. `odudu seed user --password` is the bootstrap exception.
- **`odudu seed` creates the first of everything and does not amend** (a decision): once the admin API exists, changing a client belongs to it, so a client column has one door and not two. Its client flags cover what an application needs on day one: redirect and post-logout addresses, web origins, grants, consent, service scopes and, for a service, the admin capabilities its account starts with (`--capability`): the admin API can give one only to a caller that already holds one, so the first credential has to be made here, and a later change is the admin API's. It has none for back-channel logout or impersonation, and cannot create a `private_key_jwt` or `tls_client_auth` client; use the admin API or dynamic registration.
- **A refused credential or session change writes no audit row**, ADR 0037's amendment: a link's key is chosen by the caller, and a refused change on a signed-in session is form validation. Sign-in steps, the token endpoints and the admin API do record their refusals.
- **A successful `/introspect` or `/userinfo` call writes no row**, a decision: each is a read a resource server makes per request, and the grant was recorded when it was issued.
- **The MCP endpoint answers no browser page at another origin, and its tools declare no output schema** (a decision): its `Origin` check admits only the tenant's own address, and the MCP clients Odudu is written for are programs, not pages. A browser client of its own makes it a decision again.
- **No enterprise-managed authorization for MCP** (a decision, for now): that extension has an organisation's own identity provider vouch for the person, so a client skips the sign-in and the server needs an upstream provider it trusts to do so. Odudu is the identity provider and has no upstream to trust, and the extension rests on drafts of the IETF's working group that are still changing. It is revisited when an operator asks to sign people in to MCP clients through their organisation's existing provider, which is the identity brokering of P6, and the MCP extension is looked at again when P6 ships.
- **CIBA delivery by `ping` or `push`, a `user_code` and signed authentication requests are not served** (a decision, for now): poll mode needs no endpoint on the client and no notification-security story, and signed requests belong with the FAPI profile, so they come with P13 if a client asks. The OpenID Foundation's suite has no plan for plain CIBA, only the FAPI one.
- **TLS is ended in front of the server, never by it** (ADR 0020): in production the server refuses to boot until you assert that something in front does it.
- **Expired state is deleted by one pass on a window per table** (ADR 0024, ADR 0021): `odudu reap`, run by the server or by your scheduler. A refresh token is kept for the life of its grant family, because deleting it sooner would disable reuse detection.
- **Four operator commands have no button in the console** (ADR 0024, a decision). `odudu reap`, `odudu send-mail` and `odudu send-logouts` are passes the server runs on its own schedule, which a deployment may switch off (`ODUDU_REAP_ENABLED`, `ODUDU_OUTBOX_ENABLED`, `ODUDU_LOGOUT_SENDER_ENABLED`) and schedule itself. `odudu client-origins rebuild` is run once after an upgrade that adds client origins.
- **No sign-in form that runs in an app's own page, and so no password in an app's code** (a decision, until P14's flow API exists): an app's SDK sends the person to Odudu's pages, which keep the one content-security policy and one anti-forgery rule that protect a credential.
- **No template logic in a theme: no conditionals, no loops** (a decision, for now). Slot templates, per-client themes and per-locale text cover the common cases, and logic would add a sandboxed engine and execution limits to the attack surface. Liquid-style template logic is revisited when a user asks for it, and placed then.
- **A paid, hosted layer, never required** (ADR 0042): planned, with no date, and nothing in the open product waits on it.
