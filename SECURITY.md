# Security policy

## Status of this project

Odudu is under active construction and has not been security reviewed. It
should not be deployed in front of real users. See the notice at the top of
the README.

This does not make security reports unwelcome — the opposite. Finding flaws
now, while the design is still cheap to change, is more valuable than
finding them later.

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/wizzywit/odudu/security/advisories/new).
Please do not open a public issue for a security flaw.

If private reporting is unavailable to you, email
wisdompraise968@gmail.com with `[odudu security]` in the subject.

Include what you need to make the problem reproducible: the affected
endpoint or component, the request or configuration that triggers it, and
what an attacker gains.

## What to expect

This is a personal project maintained in bursts, so response times are best
effort rather than contractual. You will get an acknowledgement, an
assessment of impact, and credit in the fix unless you prefer otherwise.

## Scope

In scope: anything in this repository — the provider, the admin surface, the
agent delegation logic, the container and compose definitions, and the CI
configuration.

Particularly interesting, because they are the parts most likely to be
subtly wrong:

- token issuance, validation, and refresh rotation
- realm isolation, including any path that reaches the database without a
  realm context
- agent delegation: any way to widen scopes, extend a lifetime beyond a
  parent, exceed a budget, or escape revocation
- signing key handling and rotation

Out of scope: findings that depend on a deployment ignoring the README's
warning and running this in production anyway.
