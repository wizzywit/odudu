---
title: Odudu next to other identity providers
sidebar_position: 2
description: What Odudu does today and where each capability is shown, what it does not do, and which other projects to read about.
---

# Odudu next to other identity providers

You may be choosing between Odudu and another identity provider you run yourself. This page says what Odudu does today, with a page that shows each thing working, and what it does not do. It says nothing about the others, because facts about other projects go out of date. Read their own pages for those.

## What Odudu does today

Each row links to a page that shows the capability working, with the requests that were made and the answers that came back.

| Feature                                           | Where it is shown                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sign-in with the authorization code flow and PKCE | [Sign a user in](../guides/sign-a-user-in.md)                                               |
| Refresh tokens that rotate, and reuse detection   | [Refresh and end a session](../guides/refresh-and-end-a-session.md)                         |
| Client credentials for services                   | [Path C](../reference/transcripts/request-paths/path-c-client_credentials.md)               |
| Token exchange                                    | [Path D](../reference/transcripts/request-paths/path-d-token-exchange.md)                   |
| Logout started by the app                         | [RP-initiated logout](../reference/transcripts/request-paths/rp-initiated-logout.md)        |
| Many tenants in one installation                  | [Tenants in the admin API](../reference/generated/admin-api/tenants/index.md)               |
| Two-factor sign-in with an authenticator app      | [TOTP](../reference/transcripts/request-paths/two-factor-authentication-with-totp.md)       |
| Passkeys                                          | [Enrolling a passkey](../reference/transcripts/request-paths/enrolling-a-passkey.md)        |
| Recovery codes                                    | [Recovery codes](../reference/transcripts/request-paths/recovery-codes.md)                  |
| Lockout after repeated failures                   | [Brute-force lockout](../reference/transcripts/request-paths/brute-force-lockout.md)        |
| Self-registration and password reset              | [Self-registration](../reference/transcripts/request-paths/self-registration.md)            |
| Roles, groups and client scopes                   | [Roles](../reference/generated/admin-api/roles/index.md)                                    |
| An admin console                                  | [Admin console](../admin-console/index.md)                                                  |
| An admin API                                      | [Admin API overview](../reference/generated/admin-api/index.md)                             |
| An audit trail of what was done and by whom       | [Audit events](../reference/generated/events.md)                                            |
| Cross-origin calls from a browser app             | [CORS](../reference/transcripts/request-paths/cors-the-preflight-and-the-request-differ.md) |

## What Odudu is not

- It is before 1.0, and 0.1.0 is its first stable release. It has not had an independent security review yet, so start small.
- It runs as one instance. Several copies behind a load balancer would race on migrations and each allow the full request rate. The [roadmap](../roadmap.md) places that work.
- It does not sign people in through another identity provider, connect to LDAP, speak SAML or accept SCIM provisioning yet. The roadmap names the phase for each.
- There is no hosted service. One is planned and has no date.

## Other projects

Keycloak, Ory, Zitadel and Authentik are well-known alternatives you can run yourself. Their own documentation is the place to read what they do today.

If you are coming from Keycloak, [Move from Keycloak](../guides/keycloak.md) maps its terms to Odudu's.
