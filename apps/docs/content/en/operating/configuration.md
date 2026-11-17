---
title: Production settings
description: Which settings the server will not start without in production, and where the full list of variables is.
---

# Production settings

Odudu is configured by environment variables, read once when the server or a command starts. This page tells you which ones a production server cannot start without and why. The full list, with type, bounds and default for every variable, is [the configuration reference](../reference/generated/configuration.md), which is generated from the server's own schema and so cannot drift from it.

A value that does not fit its type or bounds stops the server from starting, and the message names the variable. A variable marked secret holds a credential: keep it out of images, logs and source control.

## What the server refuses to start without

With `NODE_ENV=production`, which the image sets, the server checks its settings before it listens and stops with a message naming the one that is wrong. Each check is a guard, and each exists because the setting it protects fails silently when wrong.

| Setting                           | What the server refuses                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ODUDU_APP_DATABASE_URL`          | Starting without it. `ODUDU_DATABASE_URL` is the owner role, which can switch row-level security off, so it is for migrations only. The guard checks that the variable is set, not what role it names; [Hardening](./hardening.md) says how to check that yourself. |
| `ODUDU_KEK`                       | Starting with the throwaway key the repository's example file ships. It is public, and the key wraps every signing key and console token.                                                                                                                           |
| `ODUDU_TLS`                       | Starting unless it is `true`, which states that TLS ends in front of the server, or with `true` beside an `http` `ODUDU_PUBLIC_BASE_URL`. Every credential Odudu issues travels as plaintext without TLS, and the two must agree.                                   |
| `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` | Starting with it on. It lets a client's `jwks_uri` or back-channel logout address resolve to a private address, which is server-side request forgery.                                                                                                               |
| `ODUDU_PUBLIC_BASE_URL`           | Starting without it. It is the issuer every token names, and the source of the passkey relying party id; neither is ever taken from a request header. A passkey bound to the wrong domain is unusable.                                                              |

While the console is on, which it is by default, the server also checks its own setup, in any environment:

| Setting                    | What the server refuses                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ODUDU_PUBLIC_BASE_URL`    | Starting without it. The console's redirect address is built from it, never from a request.                                                         |
| `ODUDU_TLS`                | `true` with an `http` base, or off with an `https` base. Every cookie follows `ODUDU_TLS`, so the two must agree with the address the browser uses. |
| `ODUDU_CONSOLE_CLIENT_KEY` | Starting without it. It is the private key the console signs in with. Set `ODUDU_CONSOLE=false` to run without a console at all.                    |

`ODUDU_DATABASE_URL` and `ODUDU_KEK` are required in every environment. Changing `ODUDU_KEK` later makes the stored keys unreadable, so treat it as data you must not lose: [Backups](./backups.md) says how.

## Two guards rest on you

`ODUDU_TLS` and `NODE_ENV` are statements the server cannot check. Setting `ODUDU_TLS=true` with nothing in front of it, or `NODE_ENV=development` on a public server, silences the guards rather than satisfying them. The server's protection here is to refuse the honest mistakes. It cannot refuse a false statement.

## Cookie names

One setting decides every cookie: `ODUDU_TLS`. Turn it on and each cookie gains `Secure` and a prefix the browser enforces. Turn it off, as local http needs, and the prefix and `Secure` go.

| Cookie                      | With `ODUDU_TLS=true`                       | Without                              |
| --------------------------- | ------------------------------------------- | ------------------------------------ |
| Sign-in session             | `__Host-<tenant>-session`                   | `<tenant>-session`                   |
| Remembered sign-in          | `__Host-<tenant>-session-persistent`        | `<tenant>-session-persistent`        |
| Browser device              | `__Host-<tenant>-device`                    | `<tenant>-device`                    |
| Sign-in in progress         | `__Secure-odudu-sign-in`                    | `odudu-sign-in`                      |
| Console session             | `__Host-odudu-console`                      | `odudu-console`                      |
| Console sign-in in progress | `__Host-odudu-console-login` and `-restart` | `odudu-console-login` and `-restart` |
| Theme choice                | `odudu-theme`, with `Secure`                | `odudu-theme`                        |

All but the theme cookie are `HttpOnly`, and none sets a `Domain`. The browser device cookie is set at a sign-in and lasts 400 days; [Sessions](../concepts/sessions.mdx#what-a-session-is) says what it is for. The sign-in in progress is scoped to its tenant's path, which is why it takes `__Secure-` rather than `__Host-`. The theme cookie is a preference the console's script writes, so it keeps its name. The browser, not the server, decides what to do with `Secure`. If a person opens the server over plain http while `ODUDU_TLS=true`, the browser may refuse the cookies. Sign-in then fails visibly instead of working without protection.

## Related settings, by the job they do

- **Who reaches the server:** `ODUDU_HTTP_HOST`, `ODUDU_HTTP_PORT`, `ODUDU_PUBLIC_BASE_URL`, `ODUDU_TRUST_PROXY`. See [Deploying](./deploying.md).
- **Throttles:** the per-origin, sign-in and client-secret limits and windows under "Rate limits" in the reference. They count in the memory of one process, which is one reason there is one instance ([Scaling](./scaling.md)).
- **Retention:** how long each kind of expired row is kept, under "Retention".
- **Background passes:** whether the server runs retention, mail and logout delivery itself, under "Background passes".
- **Mail:** the `ODUDU_SMTP_*` settings, under "Mail".
- **Documentation:** `ODUDU_DOCS` and `ODUDU_DOCS_DIR`. The server serves the copy of these pages built into its image from its own address, under a `docs` route, marked so search engines skip it. Set `ODUDU_DOCS=false` to serve none.
