---
title: Introduction
description: What Odudu is, who it is for and how the documentation is laid out.
---

# Introduction

Odudu is an OpenID Connect and OAuth 2.0 identity provider that you run yourself. Your apps send people to it to sign in, and get back tokens they can trust. It comes with an admin console, a command-line tool and documentation that is checked against the running server.

It suits you if you build or run apps that need people to sign in: a web app, a single-page app, an API, or a service that calls another service.

Odudu is a release candidate. It runs as one instance, and the [roadmap](../roadmap.md) lists what is missing and which phase brings it. Try it, build against it and tell us what you find.

## Licence and language

Odudu is free software under the GNU Affero General Public License, version 3 (`AGPL-3.0-only`). You may run it, study it and change it. If you let other people use a changed version over a network, the licence asks you to offer them that version's source. Read the [licence](https://github.com/wizzywit/odudu/blob/main/LICENSE) itself for the terms; this is not legal advice. The name and the mark have their own [trademark policy](https://github.com/wizzywit/odudu/blob/main/TRADEMARK.md).

The pages and mail Odudu sends come in English and Arabic, and Arabic reads right to left. A tenant lists the languages it offers. Odudu has no SDK of its own: use any OpenID Connect library, as the [guides](../guides/index.md) do.

## Where to start

1. **Run it.** The [quick start](../quick-start/index.mdx) gets a server running and you signed in to its console, then signs a person in to an app. It takes about ten minutes.
2. **Connect your app.** Pick the [guide](../guides/index.md) for what you are building: a web app, a single-page app, an API or a service. A guide ends with a working sign-in.
3. **Learn the ideas.** [Concepts](../concepts/index.md) explains tenants, clients, tokens and sessions, once you have seen them work.

## Read more about Odudu

- [The name Odudu](./odudu.md) says what an identity provider holds and why you run it yourself.
- [Odudu next to other identity providers](./compare.md) says what Odudu does today, what it does not, and where to read about the alternatives.

## Where everything else is

- [Admin console](../admin-console/index.md) shows what the console manages.
- [Operating Odudu](../operating/index.md) is for the person who deploys it.
- [Reference](../reference/index.md) is where you look things up, and where the full recorded transcripts live.
- [Security](../security/index.md) says how Odudu protects what it holds.
- [Contributing](../contributing/index.md) is for building Odudu from source.
