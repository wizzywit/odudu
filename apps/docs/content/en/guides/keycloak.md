---
title: Move from Keycloak
description: Which Keycloak concepts Odudu has under what name, how to rebuild a realm's roles and groups as a tenant, and what does not move.
sidebar_position: 9
---

# Move from Keycloak

You run Keycloak today and are thinking of moving an app to Odudu. This page maps the ideas you already know to Odudu's, rebuilds a small set of roles and groups by hand, and says plainly what does not move. Odudu cannot read a Keycloak export, so a move is a rebuild, and for a few realms that is a short job.

## 1. Learn the names

Most of what you know carries over under another name.

| In Keycloak         | In Odudu                          | Where it is shown                                                                                                |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Realm               | Tenant                            | [Tenants](../reference/generated/admin-api/tenants/index.md)                                                     |
| Client              | Client, public or confidential    | [Sign people in to a web app](./web-app.md)                                                                      |
| User                | User                              | [Subjects](../reference/generated/admin-api/subjects/index.md)                                                   |
| Realm role          | Tenant role                       | [Roles](../reference/generated/admin-api/roles/index.md)                                                         |
| Client role         | Client role, named for its client | [Roles](../reference/generated/admin-api/roles/index.md)                                                         |
| Composite role      | Composite role                    | [Roles](../reference/generated/admin-api/roles/index.md)                                                         |
| Group               | Group, with roles for its members | [Groups](../reference/generated/admin-api/groups/index.md)                                                       |
| Client scope        | Client scope                      | [Scopes](../reference/generated/admin-api/scopes/index.md)                                                       |
| Protocol mapper     | Claim mapper on a scope           | [Scopes](../reference/generated/admin-api/scopes/index.md)                                                       |
| Required action     | Required action                   | [Following a required-actions link](../reference/transcripts/request-paths/following-a-required-actions-link.md) |
| Events              | Audit trail                       | [Audit events](../reference/generated/events.md)                                                                 |
| Authentication flow | The tenant's authentication flow  | [Flow](../reference/generated/admin-api/flow/index.md)                                                           |

Some things are not there yet: signing in through another identity provider, LDAP, SAML and SCIM. The [roadmap](../roadmap.md) names the phase for each.

## 2. Find your endpoints

An app moves by changing the address it trusts. Every Odudu tenant has its own issuer and its own discovery document, and the protocol endpoints sit under the tenant's address. Your app's OpenID Connect library needs only the issuer.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

```sh {run expect="token_endpoint"}
curl -fsS "$TENANT/.well-known/openid-configuration" | sed -E 's/,"/,\n"/g' | grep -E '"(issuer|authorization_endpoint|token_endpoint|jwks_uri)"'
```

## 3. Rebuild a realm's roles and groups

You need the stack from the [quick start](../quick-start/index.mdx), with its `demo` tenant and its user `ada`, and you run these in the folder that holds `compose.yaml`. This stands in for a realm with one role, one group that carries it and one member.

Create the role.

```sh {run expect="roleId"}
docker compose exec odudu odudu seed role --tenant demo --name editor
```

Create the group and give its members the role.

```sh {run expect="/staff"}
docker compose exec odudu odudu seed group --tenant demo --name staff
```

```sh {run expect="/staff"}
docker compose exec odudu odudu seed map-group-role --tenant demo --group /staff --role editor
```

Put a user in the group.

```sh {run expect="/staff"}
docker compose exec odudu odudu seed join-group --tenant demo --username ada --group /staff
```

`ada` now has the `editor` role through the group. For a larger realm you do the same through the [admin API](../reference/generated/admin-api/index.md) or the [console](../admin-console/index.md), which can be scripted, instead of one command at a time.

## 4. Know what does not move

- **Passwords.** Odudu does not read password hashes from another system. A user you create through the admin API gets an `update-password` action and chooses a password at first sign-in. [Creating a subject](../reference/transcripts/admin-paths/post-subjects.md) shows it.
- **Client secrets.** A client secret is never exported, from Odudu either, so register each confidential client again with a new secret and give it to the app.
- **Sessions and consents.** People sign in again.
- **Anything in the missing list above.**

## 5. Move a tenant between Odudu installations

Once a tenant is rebuilt, its configuration exports as one document, and the document creates a new tenant elsewhere. It carries settings, clients, roles, groups, scopes and every sign-in flow, each by name, with the flow each client uses, and it names the secrets it leaves out. The two pages show both halves.

- [`GET /export`](../reference/transcripts/admin-paths/get-export.md)
- [`POST /admin/tenant-imports`](../reference/transcripts/admin-paths/post-admintenant-imports.md)

An import always creates a new tenant. Moving more than 10,000 users is the work of the inbound provisioning the roadmap places.
