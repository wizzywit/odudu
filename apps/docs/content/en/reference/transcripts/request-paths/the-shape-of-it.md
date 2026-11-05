---
title: 'The shape of it'
description: 'A tenant has its own users, clients, signing keys and sessions, isolated in the database by PostgreSQL row-level security (ADR 0009).'
---

# The shape of it

A **tenant** has its own users, clients, signing keys and sessions,
isolated in the database by PostgreSQL row-level security (ADR 0009). Every
protocol endpoint lives under `/tenants/{tenant}/`, so the tenant is chosen by
the URL and never by a header or a parameter.

| Method | Path                                                         | What it is                                                                            |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `GET`  | `/tenants/{tenant}/.well-known/openid-configuration`         | Discovery document                                                                    |
| `GET`  | `/.well-known/oauth-authorization-server/tenants/{tenant}`   | Authorization server metadata (RFC 8414), [below](./authorization-server-metadata.md) |
| `GET`  | `/tenants/{tenant}/.well-known/oauth-authorization-server`   | The same document, at a tenant's own domain                                           |
| `GET`  | `/tenants/{tenant}/protocol/openid-connect/certs`            | JWKS (public signing keys)                                                            |
| `GET`  | `/tenants/{tenant}/protocol/openid-connect/auth`             | Authorization endpoint                                                                |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/auth`             | Authorization endpoint (form)                                                         |
| `POST` | `/tenants/{tenant}/login-actions/authenticate`               | Login form submission                                                                 |
| `POST` | `/tenants/{tenant}/login-actions/consent`                    | Consent screen submission (allow/deny)                                                |
| `POST` | `/tenants/{tenant}/login-actions/select-account`             | Account chooser submission                                                            |
| `POST` | `/tenants/{tenant}/login-actions/required-action`            | Complete a pending required action (enrolment, password)                              |
| `POST` | `/tenants/{tenant}/login-actions/passkey-challenge`          | Request options for a usernameless passkey assertion                                  |
| `GET`  | `/tenants/{tenant}/login-actions/registration`               | Self-registration form                                                                |
| `POST` | `/tenants/{tenant}/login-actions/registration`               | Self-registration submission                                                          |
| `GET`  | `/tenants/{tenant}/login-actions/action-token`               | Redeem a mailed action token (verify email, reset password, required actions)         |
| `POST` | `/tenants/{tenant}/login-actions/action-token`               | Submit a new password, or the required actions, against a token                       |
| `GET`  | `/tenants/{tenant}/login-actions/reset-password`             | Password reset request form                                                           |
| `POST` | `/tenants/{tenant}/login-actions/reset-password`             | Password reset request submission                                                     |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/token`            | Token endpoint                                                                        |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/token/introspect` | Token introspection (RFC 7662)                                                        |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/revoke`           | Token revocation (RFC 7009)                                                           |
| `GET`  | `/tenants/{tenant}/protocol/openid-connect/userinfo`         | UserInfo                                                                              |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/userinfo`         | UserInfo (form)                                                                       |
| `GET`  | `/tenants/{tenant}/protocol/openid-connect/logout`           | RP-initiated logout (`end_session_endpoint`)                                          |
| `POST` | `/tenants/{tenant}/protocol/openid-connect/logout`           | RP-initiated logout (form-serialized), confirmation form                              |
| `POST` | `/tenants/{tenant}/clients-registrations/openid-connect`     | Dynamic client registration (RFC 7591)                                                |
| `GET`  | `/health/live`, `/health/ready`                              | Liveness, readiness                                                                   |
| `GET`  | `/docs`, `/docs/*`                                           | The documentation, [below](./the-documentation-under-docs.md)                         |

`/login-actions/authenticate` is deliberately outside the
`/protocol/openid-connect/` namespace: that namespace is the OIDC wire
protocol, and the login form is Odudu's own UI, which no specification
describes and no client library calls.

Four grant types reach `/token`: `authorization_code`, `refresh_token`,
`client_credentials` and RFC 8693 token exchange
(`urn:ietf:params:oauth:grant-type:token-exchange`, [Path
D](./path-d-token-exchange.md)). They share almost everything. Client
authentication, scope resolution, access-token minting and the response
envelope are one path for all four; only one stage — deciding whether this
client may have this grant, and what subject it names — is grant-specific.
That is why the error vocabulary is so uniform below: most refusals come
from shared code. `config.grantTypes` gates all four alike: a client not
registered for the grant it sends is refused `unauthorized_client` before
anything grant-specific runs.
