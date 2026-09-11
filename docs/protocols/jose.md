# JOSE — RFC 7515, RFC 7517, RFC 7518, RFC 7519

**Status in Odudu:** RFC 7515 (JSON Web Signature), RFC 7517 (JSON Web
Key), RFC 7518 (JSON Web Algorithms), and RFC 7519 (JSON Web Token) are
consumed through the [`jose`](https://github.com/panva/jose) library
(pinned at 6.2.12), not implemented by Odudu. Signing, serialization,
algorithm implementations, and JWT encoding are `jose`'s code, not ours;
tracing those four RFCs clause by clause would be tracing someone else's
work, and the traceability tool exists to keep Odudu's own MUSTs
countable, not to audit a third-party dependency.

This table is deliberately not exhaustive. It rows only the clauses Odudu
depends on directly — where Odudu's own code makes a decision the RFC
constrains, rather than merely calling into `jose` and trusting its
result — and folds every other clause across all four RFCs into the
single `n/a` row at the bottom. **That collapse is intentional and is the
one place in this phase's traceability where collapsing several
provisions into one row is correct**, precisely because the alternative
(one row per clause of four RFCs neither implemented nor decided by
Odudu) would inflate the trace with rows that assert nothing about
Odudu's own code. A later reader should not "fix" this by expanding it.

The four areas kept individually traced, and why each is Odudu's problem
and not `jose`'s:

- **RFC 7515 §4.1.1 (`alg`) and §5.2 (validation order).** Algorithm
  confusion — accepting a token signed with an algorithm the verifier
  didn't intend to trust, most famously `alg: none` or an asymmetric
  public key replayed as an HMAC secret — is an entry in Odudu's
  adversarial corpus (design spec §5). `jose` will validate a signature
  correctly against whatever algorithm the caller allows; which
  algorithms are allowed for which key is Odudu's decision, made at every
  call site, and that decision is the thing worth tracing.
- **RFC 7515 §4.1.4 (`kid`).** The RFC leaves `kid`'s structure
  unspecified — it is an opaque hint, not a defined format — which is
  exactly why treating it as a filesystem path, a database key without
  parameterization, or anything else with structure Odudu imposes,
  invites a `kid`-path-traversal entry in the adversarial corpus. `jose`
  reads and writes the `kid` header faithfully; what Odudu does with the
  value it gets back is Odudu's decision.
- **RFC 7517 §4 (JWK members).** "The published JWK Set contains no
  private or symmetric key members" is an assertion about what Odudu
  chooses to serialize into `/jwks`, not something `jose` enforces on
  Odudu's behalf — the library will happily export a private key if
  asked to.
- **RFC 7519 §4.1 (registered claims) and §7.2 (validation).** `jose`
  will encode and check claims once told what to check; deciding to check
  `aud`, `exp`, and issuer, and generating a collision-resistant `jti`
  are Odudu's decisions, made at the call sites that mint and verify
  tokens.

## Clause table

| Clause                             | Level  | Requirement                                                                                                                                           | Test ID | Status                                        |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| RFC7515-4.1.1                      | MUST   | the `alg` header parameter is present on every JWS                                                                                                    | —       | gap                                           |
| RFC7515-4.1.1                      | MUST   | the `alg` header parameter's value is understood and processed by the verifier                                                                        | —       | gap                                           |
| RFC7515-5.2                        | MUST   | the algorithm used to validate a JWS signature is accurately represented by the `alg` header parameter's value                                        | —       | gap                                           |
| RFC7515-5.2                        | SHOULD | a JWS whose signature validates is nonetheless treated as invalid unless its algorithm is one the verifying call site explicitly accepts for that key | —       | gap                                           |
| RFC7515-4.1.4                      | MUST   | the `kid` header parameter's value is a case-sensitive string, with a structure this specification leaves otherwise unconstrained                     | —       | gap                                           |
| RFC7517-4                          | MUST   | the JWK Set Odudu publishes at `/jwks` carries only public key members — no private or symmetric key values                                           | —       | gap                                           |
| RFC7519-4.1                        | MUST   | Claim Names within a minted JWT's Claims Set are unique                                                                                               | —       | gap                                           |
| RFC7519-4.1                        | MUST   | when an `aud` claim is present, the principal processing the JWT identifies itself with a value in it, or the JWT is rejected                         | —       | gap                                           |
| RFC7519-4.1                        | MUST   | a JWT is not accepted for processing on or after the time identified by its `exp` claim                                                               | —       | gap                                           |
| RFC7519-4.1                        | MUST   | a minted JWT's `jti` value is assigned so that the probability of collision with another value from the same issuer is negligible                     | —       | gap                                           |
| RFC7519-7.2                        | MUST   | if any JWT validation step fails, the JWT is rejected outright                                                                                        | —       | gap                                           |
| RFC7519-7.2                        | SHOULD | a JWT that decodes and validates structurally is nonetheless rejected unless its algorithm is one the verifying call site accepts                     | —       | gap                                           |
| RFC7515/7517/7518/7519 (remainder) | MUST   | every other provision of JSON Web Signature, JSON Web Key, JSON Web Algorithms, and JSON Web Token                                                    | —       | n/a: implemented by jose 6.2.12, not by Odudu |
