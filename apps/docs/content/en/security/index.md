---
title: Security
description: How Odudu protects credentials, sessions and tenants, and how to report a problem.
---

# Security

You are deciding whether to trust Odudu with the people who sign in to your apps, or you have found something wrong. This section answers both. It says what Odudu defends against and what it does not, and it says how to tell us about a flaw.

Read the status first, because it decides how much of the rest you can lean on.

## Status

Odudu is before 1.0 and has not had an independent security review, as the README says. Its protocol handling is checked against the OpenID Foundation's Config OP test plan in CI, and its defences each have a test written to attack them, but neither of those is a review. This section does not say otherwise. Everything under [Operating](../operating/index.md) is how to run it as safely as the product allows today.

## The pages

1. [The threat model](./threat-model.md) says what Odudu protects, who it assumes an attacker is, how each defence works and where each one stops.
2. [Disclosure](./disclosure.md) says how to report a vulnerability and what to expect after you do.

## What is not claimed

Odudu does not claim OpenID Foundation Basic OP certification and will not. That profile predates mandatory PKCE, so most of its modules send a request Odudu refuses. [The decision record](https://github.com/wizzywit/odudu/blob/main/docs/adr/0016-mandatory-pkce-over-basic-op.md) has the reasoning, and the [roadmap](../roadmap.md) says what is decided against and why.
