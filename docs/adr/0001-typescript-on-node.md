# 0001 — TypeScript on Node 24

**Status:** Accepted · 2026-09-10

## Context

Odudu needs a runtime for a long-lived, crypto-heavy, stateful server with
a large domain model, an admin API consumed by a React console, and an
awkward long tail of integrations (XML-DSig, Kerberos, LDAP).

The author's expertise is TypeScript. The stated purpose of the project is
learning identity protocols deeply.

## Decision

TypeScript on Node 24 LTS.

## Rationale

The language is not the learning target; the protocols are. Every hour
spent on an unfamiliar toolchain is an hour not spent on refresh-token
rotation or WebAuthn attestation.

The ceiling is demonstrated, not assumed: `node-oidc-provider` is an
officially OpenID-certified provider written in JavaScript, and Logto ships
the full product shape — provider, admin API, console, tenancy — in
TypeScript. `jose`, from the same author as the certified provider, is
arguably the best JWS/JWE/JWKS library in any ecosystem.

TypeScript also gives native type sharing between the server and the
console, which for an admin API of this size is a large, recurring saving
that every other candidate pays for with code generation.

## Consequences

- Argon2id would block the event loop. Mitigated with `@node-rs/argon2`,
  which runs on the libuv thread pool. Load-tested in P2 rather than
  assumed.
- SAML is the genuine weak spot. Node's `xml-crypto` and `passport-saml`
  lineage has a real CVE history around signature wrapping and
  canonicalization. The runtime for SAML is re-evaluated at P8; a separate
  JVM module using OpenSAML is an acceptable outcome.
- Kerberos support on Node is poor. Deferred; it is the least-used
  Keycloak feature.
- We do not depend on `node-oidc-provider`. Building the provider is the
  point. `jose` supplies primitives only, and JWS is hand-rolled once in P1
  as a learning exercise before the vetted library is swapped in.

## Alternatives rejected

**Go.** Cheapest non-TypeScript ramp, best single-binary story for
self-hosting, and Zitadel is a Keycloak-parity provider in Go worth
studying. Rejected because it costs code generation at the console boundary
and lacks sum types, which this domain — dense with protocol state machines
— would use constantly.

**Kotlin/JVM (Quarkus).** Objectively the best ecosystem for the parity
long tail: Santuario and OpenSAML for XML-DSig, JGSS for Kerberos,
best-in-class LDAP. Keycloak itself becomes readable reference. Rejected
for the steepest ramp and slowest iteration, which would starve the
protocol learning that motivates the project.

**Rust.** Best type system, best performance, no GC. Rejected because async
Rust would dominate the project; fighting the borrow checker is not
learning OAuth.
