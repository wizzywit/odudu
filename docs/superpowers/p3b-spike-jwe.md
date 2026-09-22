# Spike: JWE algorithms and key selection for UserInfo encryption

**Questions:** which `alg`/`enc` pairs can `jose` actually produce for a
client's `userinfo_encrypted_response_alg`/`_enc`; how is an encryption key
selected from a client's JWKS without ambiguity; and what does fetching that
JWKS on the `/userinfo` response path cost when the fetch fails.

**Library and version:** `jose@6.2.12` (pinned in `packages/crypto`), run
under Node.js v24.15.0. `packages/protocol-oidc/src/service/client-metadata.ts`
currently admits `userinfo_encrypted_response_alg`/`_enc` as
`z.string().optional()` — any string, with no permitted set yet
(lines 144–145). "Admitted" in this document means the full JWA registry of
key-management and content-encryption algorithm identifiers a client could
plausibly register, since the metadata validator does not narrow it today.

## Which `alg`/`enc` pairs `jose` can produce

`assumption:` `jose` supports every JWA-registered `alg`/`enc` pair a client
could register. Tested with a throwaway script
(`packages/crypto/jwe-spike.throwaway.mjs`, not committed) that generated an
RSA key pair, a P-256 EC key pair, and an X25519 OKP key pair, then for each
key type tried every `alg` a public key of that type could plausibly use,
crossed with every registered `enc`, via `jose.EncryptJWT`/`jose.jwtDecrypt`.

`verified: node jwe-spike.throwaway.mjs` (run from `packages/crypto`, where
`jose` resolves):

| `alg` family                                                        | `enc` (all six registered values)     | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RSA1_5`                                                            | any                                   | **FAIL** — `Invalid or unsupported "alg" (JWE Algorithm) header value`                                                                                                                                                                                                             |
| `RSA-OAEP`                                                          | any                                   | **OK**, but only against a key generated/imported _for_ `RSA-OAEP` specifically (see below)                                                                                                                                                                                        |
| `RSA-OAEP-256`                                                      | all six                               | **OK**                                                                                                                                                                                                                                                                             |
| `ECDH-ES`, `ECDH-ES+A128KW`, `ECDH-ES+A192KW`, `ECDH-ES+A256KW`     | all six, on P-256 and on X25519 (OKP) | **OK** — 48/48 combinations succeeded                                                                                                                                                                                                                                              |
| `A128KW`, `A192KW`, `A256KW`, `A128GCMKW`, `A192GCMKW`, `A256GCMKW` | —                                     | **FAIL against an RSA public key** — `CryptoKey instances must be of type "secret"`. These are symmetric key-wrap algorithms; they need an actual `oct` key, which is not something a client publishes as a _public_ JWKS entry (an `oct` value in a JWK is the raw secret itself) |

**`RSA1_5` is not a jose implementation gap in this run — it is removed.**
`verified: curl -s https://raw.githubusercontent.com/panva/jose/main/CHANGELOG.md`
shows `* removed RSA1_5 JWE support` in the changelog, and a direct
`jose.generateKeyPair('RSA1_5', …)` call fails with `Invalid or unsupported
"alg" (Algorithm) value` (`verified: node jwe-spike2.throwaway.mjs`). If
`RSA1_5` is left in the permitted set, a client can register it, the server
will accept the registration, and every `/userinfo` request for that client
will fail at encryption time — the exact late failure narrowing exists to
prevent. **Recommendation: exclude `RSA1_5` from the narrowed permitted set
where the permitted set is narrowed.**

**`RSA-OAEP` needs a key generated or imported specifically for it.** A
CryptoKey produced by `jose.generateKeyPair('RSA-OAEP-256', …)` fails when
used with `alg: 'RSA-OAEP'` (`CryptoKey does not support this operation, its
algorithm.hash must be SHA-1`) — Web Crypto binds the OAEP hash to the key at
generation/import time, and `RSA-OAEP` uses SHA-1 where `RSA-OAEP-256` uses
SHA-256. A key generated for `RSA-OAEP` specifically works
(`verified: node jwe-spike2.throwaway.mjs`, "RSA-OAEP key generated
specifically for RSA-OAEP" section, both `enc` values tried succeeded). This
only matters for a **client-imported** JWK that already carries `alg` — see
Step 2's "bare key" finding below for the case where the JWK carries no
`alg` and the server chooses one live.

**Everything else registered for a public/asymmetric key worked cleanly:**
`RSA-OAEP-256` against all six `enc` values, and all four `ECDH-ES*`
variants against P-256 and against X25519 (OKP), against all six `enc`
values — 6 + 24 + 24 = 54 of 54 attempted combinations succeeded.

**Not tested:** `RSA-OAEP-384`, `RSA-OAEP-512` (jose added these after
`RSA-OAEP-256`, per its changelog, but they are not part of the OIDC/JWA
baseline set and nothing in this codebase references them — out of scope
unless a future registration needs them), `dir` and `PBES2-*` (excluded up
front: `dir` needs a shared symmetric key, which is not something a client
publishes as a public JWKS entry any more than `A*KW` is, and `PBES2-*` is
password-derived, not applicable to a client's asymmetric key material).

### Recommended narrowed permitted set

- `userinfo_encrypted_response_alg`: `RSA-OAEP-256`, `ECDH-ES`,
  `ECDH-ES+A128KW`, `ECDH-ES+A192KW`, `ECDH-ES+A256KW`. Excludes `RSA1_5`
  (removed from `jose`) and excludes `RSA-OAEP` (works, but only against a
  key the client generated _for_ `RSA-OAEP` — see the hash-binding finding
  above; narrowing to `RSA-OAEP-256` avoids a second live failure mode this
  spike found no clean way to detect ahead of time without attempting the
  encryption).
- `userinfo_encrypted_response_enc`: all six — `A128CBC-HS256`,
  `A192CBC-HS384`, `A256CBC-HS512`, `A128GCM`, `A192GCM`, `A256GCM` — since
  every one succeeded against every admitted `alg`.

## Key selection from a client's JWKS

`assumption:` a client's JWKS names an encryption key unambiguously by
`use: 'enc'` or by `alg`. Built four JWKS shapes and a selection rule
(`packages/crypto/jwe-spike4.throwaway.mjs`, not committed) that filters
candidates by `use` (accepts `enc` or absent), `alg` (accepts a match to the
client's registered `userinfo_encrypted_response_alg` or absent), `key_ops`
(accepts an encryption-shaped op or absent), and `kty` compatibility with
the registered `alg` family — **amended in review**: `kty` alone is not
enough on the OKP path. `RSA` for `RSA-*`; for `ECDH-ES*`, `EC` **or**
`OKP` with `crv: 'X25519'` specifically — never OKP on `kty` alone, because
`Ed25519` is also an OKP curve and is a signing key, not an ECDH one, so a
bare Ed25519 JWK (no `use`, no `alg` — the common case this same spike
established below) would otherwise pass the filter as an encryption
candidate. `verified: node jwe-spike5.throwaway.mjs`, generating an Ed25519
key pair and an X25519 key pair and running each through both forms of the
rule:

```
Ed25519 public JWK: {"crv":"Ed25519","x":"fpfrquWIWL_ZZKeygba7oITG9WTXMPjTJuN7HUNvgP0","kty":"OKP"}
Admitted by kty-only rule: true
Admitted by kty+crv rule: false
X25519 public JWK: {"crv":"X25519","x":"5DUTWyyEfc4qydrHtn_bZjA-NfmLuMkb5oCAEIZ1bwI","kty":"OKP"}
Admitted by kty+crv rule: true
ECDH-ES encryption to the Ed25519 key FAILED: ECDH with the provided key is not allowed or not supported by your javascript runtime
```

The `kty`-only rule admits the Ed25519 key as a candidate; the amended rule
does not; a real `jose` `ECDH-ES` encryption attempt against the Ed25519 key
fails, confirming it was never a usable candidate. No other curve is
supported on the OKP path — `X25519` is the only one JWA assigns to
`ECDH-ES*`, so the filter names it rather than excluding `Ed25519` by a
denylist of one.

`verified: node jwe-spike4.throwaway.mjs`:

| JWKS shape                                                                                                   | Selection result                                         |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| One key, `use: 'enc'`                                                                                        | selected — unambiguous                                   |
| Two keys, both `use: 'enc'`, no `alg` to distinguish them                                                    | **ambiguous** (2 candidates)                             |
| Two keys, both `use: 'enc'`, distinct `alg` (`RSA-OAEP-256` vs `RSA-OAEP`), client registered `RSA-OAEP-256` | selected — the `alg` filter alone breaks the tie         |
| One key, `use: 'sig'` only (no `enc` key published at all)                                                   | no candidate — refused, not "picked the only key anyway" |
| One key, no `use` and no `alg` at all (bare)                                                                 | selected — nothing to filter on, so it passes by default |

**Recommendation on the two-candidate case (a
selection rule; this goes further and recommends what the rule should do):
refuse, not pick.** The `alg` field breaks a tie cleanly when clients set it
(row 3), so the rule should filter by `alg` first. But when two keys share
both `use: 'enc'` and are silent or identical on `alg`, refuse the
`/userinfo` request with a server error rather than choosing (for example)
the first key in array order. OIDC Core §10.2.1's own text supports treating
this as a real choice the encrypting party has to make, not a corner case
the spec resolves for it:

> the encrypting party still uses the `kid` Header Parameter in the JWE to
> tell the decrypting party which private key to use to decrypt, however,
> the encrypting party needs to first select the most appropriate key from
> those provided in the JWK Set at the recipient's `jwks_uri` location
> (`verified: curl -s https://openid.net/specs/openid-connect-core-1_0.html`,
> §10.2.1 "Rotation of Asymmetric Encryption Keys")

and, on the general encryption clause (§10.2, "Encryption"):

> If there are multiple keys in the referenced JWK Set document, a `kid`
> value MUST be provided in the JOSE Header. […] The key usage of the
> respective keys MUST include encryption.

The spec permits the encrypting party to choose and only requires it to
announce the choice via `kid`. **The cost of refusing instead:** a client
that legitimately publishes two valid, equally-scoped encryption keys — the
ordinary shape of a key rotation window, where an old and a new key are both
still valid — gets every `/userinfo` request refused until it disambiguates
by `alg` or removes one key, even though nothing about either key is wrong.
That is a real cost, not a hypothetical one; it is also exactly the
"rotation becomes a guessing game" problem inverted onto the server's side —
picking silently means the client cannot predict which key protects a given
response and cannot correlate `kid` with intent without reading its own
logs, while refusing means the client's rotation window has to be one key
at a time for this parameter specifically. **Refuse anyway**, because
picking silently between two candidates the client did not distinguish is a
choice the server is making on the client's behalf about which private key
must be live to decrypt a given response, and getting it wrong is not
independently observable by the client the way an outright refusal is — a
client can react to a 5xx and republish a distinguishing `alg`; it cannot
react to "the server has been encrypting to the key I meant to retire."

## A key with no `use` and no `alg`

`assumption:` OIDC Core §5.3.2 and JWA require an encryption key to carry
`use: 'enc'` or an `alg`, or to be distinct from a client's signing key.

**Neither is required.** `verified: curl -s
https://www.rfc-editor.org/rfc/rfc7517.txt`, RFC 7517 §4.2: "Use of the
`use` member is OPTIONAL, unless the application requires its presence."
§4.4 (`alg`): likewise optional. OIDC Core §5.3.2 itself
(`verified: curl -s https://openid.net/specs/openid-connect-core-1_0.html`,
section extracted at `rfc.section.5.3.2`) says nothing about key selection
at all — it only says a client that registered
`userinfo_encrypted_response_alg` gets an encrypted response, and describes
sign-then-encrypt nesting. Key selection is left to §10.2/§10.2.1, quoted
above, which speaks only of `use` ("key usage… MUST include encryption") and
`kid`, never `alg`.

**Reusing one key for both signing and encryption is not forbidden by
`jose`, and the RFC actively discourages it without forbidding it.** Tested
directly: a JWK exported from a `PS256` (signing) key pair, imported fresh
with `alg: 'RSA-OAEP-256'`, encrypted successfully with no objection from
`jose` (`verified: node jwe-spike3.throwaway.mjs`, "reuse of signing JWK for
encryption" case). RFC 7517's neighboring `key_ops` guidance (§4.3, quoted
because it states the general principle `use` doesn't spell out as
explicitly) says why this is discouraged rather than banned:

> Multiple unrelated key operations SHOULD NOT be specified for a key
> because of the potential vulnerabilities associated with using the same
> key with multiple algorithms. Thus, the combinations "sign" with
> "verify", "encrypt" with "decrypt", and "wrapKey" with "unwrapKey" are
> permitted, but other combinations SHOULD NOT be used.
> (`verified: curl -s https://www.rfc-editor.org/rfc/rfc7517.txt`)

**A bare key (no `use`, no `alg`) is the common case, not an edge case —
it's what `jose.exportJWK` produces by default** (`verified: node
jwe-spike3.throwaway.mjs` — `exported JWK members: [ 'kty', 'n', 'e' ]`, no
`use`, no `alg`). Practically this means: `kty`-and-`crv` compatibility with
the client's registered `alg` (RSA key ⇒ `RSA-*` algs; EC key or OKP key
with `crv: 'X25519'` ⇒ `ECDH-ES*` algs — an OKP key with `crv: 'Ed25519'`
matches neither, per the amendment above) is the _only_ filter that always
applies, because `use` and `alg` on
the key itself are both frequently absent. The selection rule from Step 2
already treats a missing `use`/`alg` as "does not exclude this candidate,"
which is why the bare-key row above selects successfully when it is the
only candidate — but it is exactly this permissiveness that turns "two keys,
both silent on `use` and `alg`" into the ambiguous case this document
recommends refusing.

**One more consequence of the missing `alg`, found while testing this
question, not asked for by the plan:** `jose.importJWK` requires an `alg`
argument whenever the JWK itself carries none —
`"alg" argument is required when "jwk.alg" is not present`
(`verified: node jwe-spike3.throwaway.mjs`). This is not optional plumbing:
whatever imports a client's fetched JWK for encryption must pass the
client's _registered_ `userinfo_encrypted_response_alg` as that argument
explicitly, every time, because the key itself will usually not carry one.

## Question 2: cost of a dead `jwks_uri` on the `/userinfo` path

`clientKeySet.fetch` (`packages/protocol-oidc/src/repository/client-keys.ts`)
is, as of this branch, called only from `/token`'s `private_key_jwt`
authentication path — `verified: grep -n "clientKeySet" packages/protocol-oidc/src/usecase/userinfo.ts`
returns nothing; the only other mention of `clientKeySet` near userinfo code
is the shared `oidcRoutes` plugin registration in
`packages/protocol-oidc/tests/userinfo.adversarial.int.test.ts`, not a call
from the userinfo usecase itself
(read in full: `resolveUserinfo` calls `listPublishableKeys`, `loadClaimContext`,
`resolveRoleReach`, `resolveClientWebOrigins`, `claimMappers.assemble` — no
key-set fetch at all, because response encryption isn't implemented yet).
Wiring encryption into `/userinfo` puts this fetch, for the first time, on a
path between a resource server's request and the answer it is waiting on,
not between a client and its own token request.

**What a first, cold request against a dead `jwks_uri` costs:**

1. `assertFetchableUrl` — synchronous, no network cost.
2. `deps.lookup(url.hostname)` — in production this is
   `defaultClientKeyLookup` (`apps/server/src/client-key-transport.ts`),
   which calls `dns.promises.lookup(hostname, { all: true })` directly, with
   **no timeout wrapped around it anywhere in the call chain**
   (`verified: read of client-keys.ts's fetchFresh — `await deps.lookup(...)`is a bare`await`, and `defaultClientKeyLookup`passes no`timeout`-like
option; `dns.lookup`'s Node API takes no timeout parameter at all). This
is the unbounded DNS lookup, and it is unbounded by
this codebase's own code, not by a library default this spike measured —
what actually bounds it in production is the OS resolver's own retry/
timeout behavior (glibc's `resolv.conf` defaults, or the equivalent on
   whatever the deployment target is), which this spike did not attempt to
   measure and does not control.
3. If the lookup resolves, `createClientKeyRequest`
   (`apps/server/src/client-key-transport.ts`) bounds the connect at 5s
   (`DEFAULT_CONNECT_TIMEOUT_MS`) and the whole exchange at 10s
   (`DEFAULT_TOTAL_TIMEOUT_MS`) — `verified: read of
client-key-transport.ts` lines 33–34, 104–110.

So: **a dead `jwks_uri` costs at least the OS resolver's own timeout (if DNS
itself is what's dead) or up to 10 seconds (if DNS resolves but the host is
unreachable), added directly to that `/userinfo` request's latency, with the
DNS portion having no ceiling this codebase imposes.** That full cost is
paid by whichever request is first and unlucky. `NEGATIVE_CACHE_TTL_MS`
(30_000 ms, same file) means every other request for that client, in any
realm sharing the same `jwks_uri`, gets a cached rejection in that window
instead of repeating the fetch — concurrent requests during the _first_
attempt also share it via the `inFlight` map rather than each paying the
cost separately. The 30-second window is a request-latency risk, not a
sustained one: the worst case recurs once per 30 seconds per distinct dead
`jwks_uri`, not once per request.

**This is a materially different risk than the existing `/token` use.** A
slow `jwks_uri` at `/token` delays only the misconfigured client's own
`private_key_jwt` attempt. The same fetch at `/userinfo` sits on a resource
server's request for a token that already succeeded — the resource server
did nothing wrong and has no visibility into the requesting client's key
configuration. **Recommendation for the implementing task (not this spike's
job to build, but worth stating because the cost above makes it load-bearing):**
this argues for the fetch happening with a tighter, `/userinfo`-specific
timeout than the shared `/token` defaults, and for treating a fetch failure
as a definite, fast-failing error (`invalid_client`-shaped 5xx or similar)
rather than falling back to an unencrypted response — falling back silently
would defeat the reason the client registered encryption in the first
place.

## Cross-references

- `docs/protocols/jose.md` — this document doesn't change that reading
  note's scope (it collapses RFC 7517/7518 JWE mechanics into the `n/a` row
  deliberately, since `jose` implements them, not Odudu); it adds detail
  this spike needed but does not contradict anything there. No update made.
- `packages/protocol-oidc/src/service/client-metadata.ts` lines 144–145 —
  where the permitted `alg`/`enc` sets are narrowed per this document's
  recommendation.
- `packages/protocol-oidc/src/repository/client-keys.ts` and
  `apps/server/src/client-key-transport.ts` — the fetcher and transport this
  document's Question 2 findings are about.

## What this spike did not build

Every script referenced above
(`packages/crypto/jwe-spike*.throwaway.mjs`) is throwaway, was not
committed, and was deleted after this document was written. The selection
rule in Step 2 is a spike sketch to observe behavior, not the shape the
implementing task must copy — it recommends refusing on ambiguity, which the
sketch's `'ambiguous'` outcome demonstrates is detectable, not how to wire
that refusal into a Fastify response.
