---
title: Disclosure
description: How to report a security problem in Odudu privately, and what to expect after you do.
---

# Disclosure

You think you have found a flaw in Odudu. Tell us privately first, so it can be fixed before it is public.

## 1. Report it privately

Use GitHub's [private vulnerability reporting](https://github.com/wizzywit/odudu/security/advisories/new). It reaches the maintainer and nobody else. Please do not open a public issue for a security flaw.

If private reporting is not available to you, email wisdompraise968@gmail.com with `[odudu security]` in the subject.

## 2. Say how to reproduce it

Include what is needed to make the problem happen again: the endpoint or part of the product, the request or setting that triggers it, and what an attacker gains. A short reproduction is worth more than a long description.

## 3. What happens next

Odudu is a personal project maintained in bursts, so replies are best effort, not a contract. You can expect an acknowledgement, an assessment of how serious it is, and credit in the fix unless you would rather not be named.

Odudu is before 1.0, so only the latest release is supported. A fix goes into the next release.

## What is in scope

Anything in the repository: the server, the admin API and console, the container and compose files, and the build configuration. The parts most likely to be subtly wrong, and so the most welcome reports, are token issuance and refresh rotation, tenant isolation (any path that reaches the database without a tenant), and signing key handling.

Odudu is before 1.0 and has not had an independent security review, as the README says. Findings that depend on a deployment that switches off a boot guard or ignores the [production settings](../operating/configuration.md) are out of scope. [The full security policy](https://github.com/wizzywit/odudu/blob/main/SECURITY.md) is in the repository.

Read [the threat model](./threat-model.md) first if you want to know what we already count as a limit.
