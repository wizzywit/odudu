---
title: Guides
description: Sign users in from a web app, a single-page app, an API or a machine.
---

# Guides

Sign users in from a web app, a single-page app, an API or a machine.

The guides assume you have done the [quick start](../quick-start/index.mdx), so a stack is running with its `demo` tenant. Their commands run in bash or zsh, in the folder that holds `compose.yaml`, with `curl` and `openssl` installed. Every command is the one that was run, and each guide ends with a working sign-in or a token in your hands. Each guide registers clients with fixed names, so run it once on a stack from the quick start; to run one again, start over with `docker compose down -v` and the quick start.

## Pick the one for what you are building

1. [A web app with a server](./web-app.md) keeps a secret, so it is a confidential client and proves who it is when it swaps the sign-in code.
2. [A single-page app or a mobile app](./single-page-app.md) cannot keep a secret, so it is a public client and uses PKCE alone.
3. [An API](./api.md) receives access tokens and decides whether to trust them.
4. [A service calling a service](./machine-to-machine.md) has no person to sign in, so it signs in as itself.
5. [Coming from Keycloak](./keycloak.md) maps its ideas to Odudu's and says what does not move.
6. [WordPress](./wordpress.md) lets people sign in to a WordPress site with the OpenID Connect Generic Client plugin. It was tested by hand, not by an example app.

7. [Brand a tenant](./brand-a-tenant.md) gives a tenant's sign-in page its own colours, logo, stylesheet and layout through the admin API. It needs an administrator's token, so its commands are not part of the docs commands job.

## Then learn what happens underneath

Each of these follows one journey and shows trimmed pieces of a real run, with a link to the full recording.

1. [Sign a user in](./sign-a-user-in.md): send a person to Odudu and get tokens back.
2. [Refresh and end a session](./refresh-and-end-a-session.md): keep a person signed in, catch a stolen refresh token and sign them out.
3. [An admin signs in and changes a user](./admin-signs-in-and-changes-a-user.md): sign in to the console and make a safe change.
4. [Read a refusal](./read-a-refusal.md): what an error looks like and why it happened.
