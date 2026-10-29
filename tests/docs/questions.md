# Question bank

Real questions a newcomer asks, each answered strictly from the built documentation site (the text under `apps/docs/dist/pages`, read with no source code, ADRs or memory). `Before` is the answer on the first read; `Status` is the answer after the missing text was written. A status is `answered`, `partly` or `not`. A feature that is planned is `answered` when the site says so and names its phase.

`tests/docs/questions.test.ts` holds the shape of this file. Re-read it against a fresh build when a phase changes what the site says.

## D01. What is the discovery URL for my tenant?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, admin-console/overview
- Note: The discovery document is at the tenant's issuer plus /.well-known/openid-configuration; the console's Overview copies it.

## D02. Which endpoints does Odudu serve for sign-in and what is each for?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, reference/generated/endpoints
- Note: Protocol in plain words lists each address with its job.

## D03. What is the issuer, and must my library's setting match it exactly?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/api, guides/wordpress, reference/protocol
- Note: Includes /tenants/<name>; a wrong issuer is the first thing the WordPress guide lists.

## D04. What is PKCE and do I need it?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, guides/single-page-app, security/threat-model
- Note: Required of every client, no opt-out; the single-page guide explains verifier and challenge, the protocol page defines it.

## D05. How do I register a client for a single-page app?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/single-page-app, quick-start
- Note: Public client, redirect URI, web origin.

## D06. How do I register a client for a web app with a server?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/web-app, admin-console/clients
- Note: Confidential client with a secret.

## D07. How do I register a client for a service with no user?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/machine-to-machine, admin-console/clients
- Note: Client credentials grant.

## D08. How do I get the person's claims into my app, and which does the ID token carry?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/tokens, concepts/scopes, guides/web-app
- Note: Scopes decide the claims; the console's Evaluate claims shows them.

## D09. Why is the roles claim in my token empty?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/scopes, concepts/roles-and-groups, admin-console/clients
- Note: Client not granted the roles scope, or Include all roles in tokens is off and no role is mapped.

## D10. How do I get a refresh token that survives the browser session?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/scopes, concepts/sessions, guides/refresh-and-end-a-session
- Note: offline_access; such a grant has no session.

## D11. How long do tokens last and how do I change that for one client?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/tokens, admin-console/settings, admin-console/clients
- Note: Tenant defaults and per-client lifetimes.

## D12. How does my API verify an access token?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/api, concepts/tokens
- Note: Signature, issuer, audience, type, expiry.

## D13. Where are the signing keys and how often should I refetch them?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/api, reference/protocol
- Note: JWKS endpoint; refetch on an unknown kid.

## D14. How does my app sign a person out of Odudu too?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, guides/refresh-and-end-a-session
- Note: End session endpoint with id_token_hint and a registered post-logout address.

## D15. How do I sign a person out everywhere?

- Role: Developer
- Before: answered
- Status: answered
- Pages: admin-console/subjects, admin-console/sessions, concepts/sessions
- Note: End every session on the person's Sessions tab or the tenant's.

## D16. How do I force a person to sign in again, or check without showing a page?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol
- Note: prompt=login, prompt=none, max_age.

## D17. Which scopes are built in and what does each give?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/scopes
- Note: The eight built-in scopes are listed with what each adds.

## D18. Can I add a custom claim to a token?

- Role: Developer
- Before: partly
- Status: answered
- Pages: admin-console/scopes, concepts/scopes, roadmap
- Note: Fixed: the scopes page now says mappers are built in and custom attributes are planned (P7, P10).

## D19. Why is my redirect URI refused?

- Role: Developer
- Before: answered
- Status: answered
- Pages: guides/read-a-refusal, guides/wordpress
- Note: Must match a registered address exactly; shown as a page, not redirected.

## D20. How does a service account get its roles?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/clients, admin-console/clients
- Note: Assigned on the client's Service account tab.

## D21. How can my application register itself as a client?

- Role: Developer
- Before: answered
- Status: answered
- Pages: admin-console/registration-tokens, reference/protocol, admin-console/settings
- Note: Policy under Dynamic client registration; a registration token.

## D22. How do I protect an MCP server with Odudu?

- Role: Developer
- Before: answered
- Status: answered
- Pages: roadmap, guides/api
- Note: Planned (P5a): the MCP metadata and tools. Until then the API guide's token checks apply.

## D23. How do I use token exchange?

- Role: Developer
- Before: partly
- Status: answered
- Pages: reference/protocol, admin-console/clients
- Note: Fixed: the protocol page explains delegation, impersonation and the client switch.

## D24. How do I call the admin API and with which token?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, reference/generated/admin-api/index
- Note: Audience urn:odudu:params:admin-api, from the odudu-admin client.

## D26. Which ways can a client authenticate?

- Role: Developer
- Before: answered
- Status: answered
- Pages: concepts/clients, reference/protocol
- Note: Basic secret, body secret, private_key_jwt, tls_client_auth, none.

## D27. How do I let my browser app call Odudu from another origin (CORS)?

- Role: Developer
- Before: answered
- Status: answered
- Pages: admin-console/clients, guides/single-page-app
- Note: Web origins on the client.

## D28. What are state and nonce for?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, guides/web-app
- Note: State returns unchanged; nonce is checked in the ID token.

## D29. How do I read the person's profile from UserInfo?

- Role: Developer
- Before: answered
- Status: answered
- Pages: reference/protocol, concepts/tokens
- Note: Bearer access token to the UserInfo endpoint.

## D30. Does Odudu support social login, SAML or LDAP?

- Role: Developer
- Before: answered
- Status: answered
- Pages: introduction/compare, roadmap
- Note: Not yet; the roadmap names the phase of each.

## A01. How do I add a user and give them a role?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/subjects, admin-console/roles, quick-start
- Note: Create a subject, then the Roles tab.

## A02. How does a new user get a first password?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/subjects, quick-start
- Note: Issue a one-time password or mail a reset link; they change it at first sign-in.

## A03. How do I reset a user's password?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/subjects
- Note: Issue a one-time password or Send a password reset email.

## A04. What happens when a password is reset from the mailed link?

- Role: Administrator
- Before: partly
- Status: answered
- Pages: admin-console/settings
- Note: Fixed: every session ends and every grant is revoked, and the link is spent.

## A05. How do I make registration require email confirmation?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings, admin-console/email
- Note: Self-registration plus Verify email addresses, with a mail relay.

## A06. How do I let people create their own accounts?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings
- Note: Self-registration under Registration and recovery.

## A07. How do I use my own SMTP server?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/email
- Note: Set the relay, send a test message.

## A08. What does remember me do?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings, concepts/sessions
- Note: A longer session for a person who ticks it; its own idle and maximum limits.

## A09. What does each tenant setting do?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings
- Note: Every setting is listed with its label, API name and range.

## A10. How are passwords checked?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings, security/threat-model
- Note: Length, optional rules, history, common-password list, Argon2id storage.

## A11. How do I rotate the signing keys?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/signing-keys
- Note: Stage, wait, promote, retire, delete.

## A12. What is a built-in scope and how do I restore one?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: concepts/scopes, admin-console/scopes
- Note: Restore brings back a deleted built-in scope.

## A13. How do I enable passkeys?

- Role: Administrator
- Before: partly
- Status: answered
- Pages: admin-console/sign-in-flow, admin-console/subjects
- Note: Fixed: the sign-in flow page now says how a person registers one and what ties it to the host.

## A14. How do I require a second factor?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/sign-in-flow
- Note: Ask every subject for a one-time password.

## A15. How does lockout work and how do I unlock someone?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings, admin-console/subjects
- Note: Brute force settings; clear one lockout or all.

## A16. What are recovery codes?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: concepts/sessions, admin-console/subjects
- Note: A set of ten, shown once, replaced as a set.

## A17. How do I see who changed what, and how long is it kept?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/audit-trail, concepts/consent-and-audit, admin-console/settings
- Note: Filters, export, retention.

## A18. Can an audit event be altered afterwards?

- Role: Administrator
- Before: not
- Status: answered
- Pages: concepts/consent-and-audit
- Note: Fixed: nothing in the server edits events, but they are not signed, so export what you must keep.

## A19. What does consent require and how do I turn it on?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: concepts/consent-and-audit, admin-console/clients
- Note: Consent required on the client.

## A20. How do groups give roles to people?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/groups, concepts/roles-and-groups
- Note: Roles on a group reach every member and sub-group.

## A21. What is Include all roles in tokens?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: concepts/scopes, admin-console/clients
- Note: full_scope_allowed: all roles reach the roles scope.

## A22. How does multi-tenancy work and how do I add a tenant?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: concepts/tenants, admin-console/tenants
- Note: One installation, many separate tenants.

## A23. How do I export a tenant or import one?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/tenants
- Note: Export file and Import as a new tenant.

## A24. How do I end a person's sessions?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/subjects, admin-console/sessions
- Note: End session or End every session.

## A25. How do I rotate a client secret without downtime?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/clients
- Note: Grace period keeps the old secret working.

## A26. Why does a mailed link ask me to press a button?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/settings
- Note: Mail scanners that open links cannot spend it.

## A27. How do I make someone an administrator?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/subjects, admin-console/roles, admin-console/system-administrators
- Note: Admin capabilities on the person's Roles tab.

## A29. How do I brand the sign-in pages?

- Role: Administrator
- Before: answered
- Status: answered
- Pages: admin-console/branding, admin-console/clients, roadmap
- Note: Branding in the console: a tenant's colours, font, images, stylesheet and page templates, a client's own over them, preview and publish with versions; a custom domain per tenant follows in P4j.

## A30. Which languages do the pages and mail support?

- Role: Administrator
- Before: partly
- Status: answered
- Pages: introduction/index, admin-console/branding, roadmap
- Note: English and Arabic (right to left), chosen per tenant, with the tenant's own message overrides; other translations are not shipped (P4h for the console).

## O01. How do I deploy with Docker Compose?

- Role: Operator
- Before: answered
- Status: answered
- Pages: quick-start, operating/deploying
- Note: Quick start for trying; Deploying for a real host.

## O02. How do I deploy to Kubernetes?

- Role: Operator
- Before: answered
- Status: answered
- Pages: roadmap, operating/deploying
- Note: Planned (P11): a Helm chart or manifests. Today one replica, and CronJobs can run the maintenance commands.

## O03. How do I back up and restore?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/backups
- Note: What to copy, and what is not yet proven.

## O04. How do I upgrade?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/upgrading
- Note: Steps and the commands to run after.

## O05. Can I run it behind a proxy, and who ends TLS?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/deploying, operating/hardening, operating/index
- Note: A proxy ends TLS; ODUDU_TLS and ODUDU_TRUST_PROXY.

## O06. Which configuration variables exist and which are required?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/configuration, reference/generated/configuration
- Note: Production settings and the full list.

## O07. Can I run more than one instance?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/scaling, roadmap
- Note: One instance today (P11).

## O08. What does Postgres need?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/index, operating/deploying
- Note: PostgreSQL 17, two roles.

## O09. How do I check the server is healthy?

- Role: Operator
- Before: answered
- Status: answered
- Pages: reference/generated/endpoints, operating/hardening
- Note: Live and ready endpoints; a metrics endpoint is planned (P11).

## O10. What background jobs run and how do I schedule them myself?

- Role: Operator
- Before: answered
- Status: answered
- Pages: operating/deploying, reference/generated/cli
- Note: Reap, mail and logout senders, each switchable.

## O11. How do I create the first administrator?

- Role: Operator
- Before: answered
- Status: answered
- Pages: quick-start, operating/deploying
- Note: odudu seed admin or init prints a one-time password.

## O12. How do I change what the server logs?

- Role: Operator
- Before: answered
- Status: answered
- Pages: reference/generated/configuration
- Note: ODUDU_LOG_LEVEL.

## S01. How do I report a vulnerability?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: security/disclosure
- Note: Private vulnerability reporting.

## S02. What is the threat model?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: security/threat-model
- Note: Each threat, its defence and its decision record.

## S03. Which cookies does it set?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: operating/configuration, concepts/sessions
- Note: The Cookie names table.

## S04. How are secrets and passwords stored?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: security/threat-model, operating/index
- Note: Argon2id; signing keys wrapped under ODUDU_KEK.

## S05. What happens when a refresh token is reused?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: concepts/sessions, guides/refresh-and-end-a-session
- Note: The grant family ends.

## S06. Has it been reviewed or certified?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: security/index
- Note: No outside review; checked against the Config OP plan in CI.

## S07. What is the licence and what does it ask of me?

- Role: Security reviewer
- Before: not
- Status: answered
- Pages: introduction/index
- Note: Fixed: AGPL-3.0-only, with a plain summary.

## S08. Is there an SDK, or which libraries work?

- Role: Security reviewer
- Before: not
- Status: answered
- Pages: introduction/index, guides/index
- Note: Fixed: no SDK of its own; the guides use openid-client and oauth4webapi.

## S09. How do I contribute?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: contributing/index
- Note: The contributing section and CONTRIBUTING.md.

## S10. What is planned and what was decided against?

- Role: Security reviewer
- Before: answered
- Status: answered
- Pages: roadmap
- Note: Next, Later and Decided against.
