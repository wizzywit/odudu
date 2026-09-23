# W3C Web Authentication Level 2

**Status in Odudu:** passkeys are implemented as the two ceremonies §7
defines for a relying party — registration (§7.1) and assertion
verification (§7.2) — through
[`@simplewebauthn/server`](https://simplewebauthn.dev) (pinned at 14.0.2),
with `packages/authn-flows/src/service/webauthn.ts` deciding what the
library is asked to enforce and `service/authenticators/passkey.ts`
deciding what a verified assertion means to a login.

**This table is scoped to §7, and deliberately.** Web Authentication is one
specification addressed to four parties at once: the relying party (§7),
the client, meaning a browser (§5 and §6.3's client-side algorithms), the
authenticator (§6's model and operations), and registries and extension
authors (§8 through §11). Only §7 states obligations Odudu can hold. A
clause telling a browser what to put in client data, or an authenticator
what to set in its flags, is not a requirement this server can satisfy or
fail — it is a requirement Odudu's §7 steps _check_, and each of those
checks has a row here. §13 and §14 are security and privacy
considerations, advisory rather than normative, and §12 is the extension
framework Odudu requests no extensions from.

**Two kinds of `n/a` sit in this table, and they do not mean the same
thing.** A clause a browser or an authenticator performs is not Odudu's
obligation at all. A clause `@simplewebauthn/server` performs _is_ Odudu's
obligation, discharged by a dependency this repository chose and pinned —
delegated, not inapplicable. The reason both wear the same status is that
the tool has no third one and `jose.md` set the precedent; the reason the
distinction has to be written down is that **the library rows are the list
of what to re-check when that pin moves.** A minor version that stops
rejecting a `webauthn.get` type, or starts accepting a clear User Present
flag, breaks a clause Odudu is answerable for and no test here would
notice, because no test here asserts the library's own behaviour. The
version is named in every one of those rows for that reason.

**Which signature algorithms a credential may use is the library's answer,
not this repository's, and one of them is experimental.**
`@simplewebauthn/server` 14.0.2 feature-detects post-quantum support at
import — `subtle.supports('verify', 'ML-DSA-44')` — and accepts ML-DSA
credentials wherever the runtime has it. On Node 24 it does, experimentally,
so passkey verification here covers RFC 9864's algorithms without a line in
this repository saying so and without a test asserting it. That is another
library row in the sense above: a capability inherited from the pin, to
re-check when the pin moves. The two warnings Node emits about it are
filtered out of test output only, and ADR 0025 records why that is a logging
decision rather than a dependency one.

Inside §7 the split follows `docs/protocols/jose.md`'s: where a step is a
decision Odudu makes — the RP ID and origin it expects, the challenge it
offered, whether user verification is demanded, what a counter that failed
to advance means, what gets stored — the row is closed by a test. Where a
step is a decoding or a cryptographic check the library performs on
Odudu's behalf, having been told what to enforce, the row is
`n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu`, for the
same reason that table does not trace JWS clause by clause: the row would
assert something about somebody else's code. The claims about what Odudu
_supplies_ to those checks are rowed separately, and are the ones that
carry tests.

§7.1 has 24 numbered steps and §7.2 has 22; both lists open with "the
Relying Party MUST proceed as follows", which is what levels a step MUST
in the absence of a keyword of its own.

## Clause table

| Clause      | Level  | Requirement                                                                                                                                           | Test ID               | Status                                                                                                                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7           | SHOULD | the relying party takes care not to leak sensitive information while building the options for a ceremony                                              | `WEBAUTHN2-7-01`      | covered                                                                                                                                                                       |
| 7.1 step 1  | MUST   | a `PublicKeyCredentialCreationOptions` structure is built, configured to the relying party's needs for the ceremony                                   | `WEBAUTHN2-7.1.1-01`  | covered                                                                                                                                                                       |
| 7.1 step 2  | MUST   | `navigator.credentials.create()` is called with those options, a rejected promise aborting the ceremony with a user-visible error                     | `WEBAUTHN2-7.1.2-01`  | covered                                                                                                                                                                       |
| 7.1 step 3  | MUST   | a response that is not an `AuthenticatorAttestationResponse` aborts the ceremony with a user-visible error                                            | `WEBAUTHN2-7.1.3-01`  | covered                                                                                                                                                                       |
| 7.1 step 4  | MUST   | the client extension outputs are read from the credential                                                                                             | —                     | n/a: the options request no extensions, so there are no outputs to read; `parseRegistrationResponse` keeps none                                                               |
| 7.1 step 5  | MUST   | `clientDataJSON` is UTF-8 decoded, any leading byte order mark stripped                                                                               | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 6  | MUST   | the decoded client data is parsed as JSON                                                                                                             | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 7  | MUST   | the client data's `type` is `webauthn.create`                                                                                                         | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 8  | MUST   | the client data's `challenge` equals the base64url encoding of the challenge the options carried                                                      | `WEBAUTHN2-7.1.8-01`  | covered                                                                                                                                                                       |
| 7.1 step 9  | MUST   | the client data's `origin` matches the relying party's origin                                                                                         | `WEBAUTHN2-7.1.9-01`  | covered                                                                                                                                                                       |
| 7.1 step 10 | MUST   | the client data's `tokenBinding.status` matches the state of Token Binding for the TLS connection                                                     | —                     | n/a: Token Binding (RFC 8471) was withdrawn by every browser that trialled it, so no `tokenBinding` member is ever present, and Odudu terminates no TLS connection to bind to |
| 7.1 step 11 | MUST   | a SHA-256 hash is computed over `clientDataJSON`                                                                                                      | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 12 | MUST   | the attestation object is CBOR-decoded into `fmt`, `authData` and `attStmt`                                                                           | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 13 | MUST   | the `rpIdHash` in the authenticator data is the SHA-256 hash of the RP ID the relying party expects                                                   | `WEBAUTHN2-7.1.13-01` | covered                                                                                                                                                                       |
| 7.1 step 14 | MUST   | the User Present bit of the authenticator data's flags is set                                                                                         | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 15 | MUST   | where user verification is required for the registration, the User Verified bit is set                                                                | `WEBAUTHN2-7.1.15-01` | covered                                                                                                                                                                       |
| 7.1 step 16 | MUST   | the credential public key's `alg` matches one of the options' `pubKeyCredParams` entries                                                              | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 17 | MUST   | the client and authenticator extension outputs are as expected, unsolicited or absent ones included                                                   | —                     | n/a: the options request no extensions, so no output can differ from what was asked for; the parse boundary drops any that arrive                                             |
| 7.1 step 18 | MUST   | the attestation statement format is determined by a case-sensitive match on `fmt`                                                                     | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 19 | MUST   | `attStmt` is verified by that format's own verification procedure                                                                                     | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.1 step 20 | MUST   | a list of acceptable trust anchors for the attestation type and format is obtained from a trusted source or policy                                    | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1 step 21 | MUST   | where no attestation was provided, None attestation is verified acceptable under relying party policy                                                 | `WEBAUTHN2-7.1.21-01` | covered                                                                                                                                                                       |
| 7.1 step 21 | MUST   | where self attestation was used, self attestation is verified acceptable under relying party policy                                                   | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1 step 21 | MUST   | otherwise the attestation trust path is verified to chain to an acceptable root certificate                                                           | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1 step 22 | SHOULD | a registration for a credential id already registered to a different user fails the ceremony                                                          | `WEBAUTHN2-7.1.22-01` | covered                                                                                                                                                                       |
| 7.1 step 22 | MAY    | such a registration is accepted instead, the older registration being deleted                                                                         | —                     | gap                                                                                                                                                                           |
| 7.1 step 23 | MUST   | on a verified, trustworthy attestation the account is associated with the credential id and credential public key                                     | `WEBAUTHN2-7.1.23-01` | covered                                                                                                                                                                       |
| 7.1 step 23 | MUST   | the credential id is associated with a stored signature counter initialized to the authenticator data's `signCount`                                   | `WEBAUTHN2-7.1.23-01` | covered                                                                                                                                                                       |
| 7.1 step 23 | SHOULD | the credential id is also associated with the transport hints the response reported                                                                   | `WEBAUTHN2-7.1.23-01` | covered                                                                                                                                                                       |
| 7.1 step 23 | SHOULD | those transport hints are not modified before or after being stored                                                                                   | `WEBAUTHN2-7.1.23-01` | covered                                                                                                                                                                       |
| 7.1 step 23 | SHOULD | the stored transport hints populate `allowCredentials`' `transports` in later `get()` calls                                                           | —                     | n/a: the assertion options name no credentials at all, so there is no entry for a transport hint to travel in                                                                 |
| 7.1 step 24 | SHOULD | an attestation statement that verified but is not trustworthy fails the registration ceremony                                                         | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1 step 24 | MAY    | such a credential is registered anyway and treated as one with self attestation                                                                       | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1         | MUST   | where certificates are used, the relying party has access to certificate status information for intermediate CA certificates                          | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.1         | MUST   | the relying party can build the attestation certificate chain itself when the client did not provide it                                               | —                     | accepted: "Attestation is not assessed"                                                                                                                                       |
| 7.2 step 1  | MUST   | a `PublicKeyCredentialRequestOptions` structure is built, configured to the relying party's needs for the ceremony                                    | `WEBAUTHN2-7.2.1-01`  | covered                                                                                                                                                                       |
| 7.2 step 1  | SHOULD | where `allowCredentials` is present, each entry's `transports` is what the credential reported at registration                                        | —                     | n/a: the options name no credentials, which is what makes a passkey login need no username                                                                                    |
| 7.2 step 2  | MUST   | `navigator.credentials.get()` is called with those options, a rejected promise aborting the ceremony with a user-visible error                        | `WEBAUTHN2-7.2.2-01`  | covered                                                                                                                                                                       |
| 7.2 step 3  | MUST   | a response that is not an `AuthenticatorAssertionResponse` aborts the ceremony with a user-visible error                                              | `WEBAUTHN2-7.2.3-01`  | covered                                                                                                                                                                       |
| 7.2 step 4  | MUST   | the client extension outputs are read from the credential                                                                                             | —                     | n/a: the options request no extensions, so there are no outputs to read; `parseAuthenticationResponse` keeps none                                                             |
| 7.2 step 5  | MUST   | where `allowCredentials` is not empty, the asserted credential id is one of its entries                                                               | —                     | n/a: the options send no `allowCredentials`, so the condition this step is guarded by never holds                                                                             |
| 7.2 step 6  | MUST   | the user being authenticated is identified and verified to own the credential source, by user handle where the ceremony began with no identified user | —                     | accepted: "The assertion is resolved by credential id, not by user handle"                                                                                                    |
| 7.2 step 7  | MUST   | the credential public key is looked up by the asserted credential id                                                                                  | `WEBAUTHN2-7.2.7-01`  | covered                                                                                                                                                                       |
| 7.2 step 8  | MUST   | the client data, authenticator data and signature are taken from the response                                                                         | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 9  | MUST   | the client data is UTF-8 decoded, any leading byte order mark stripped                                                                                | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 10 | MUST   | the decoded client data is parsed as JSON                                                                                                             | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 11 | MUST   | the client data's `type` is `webauthn.get`                                                                                                            | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 12 | MUST   | the client data's `challenge` equals the base64url encoding of the challenge the options carried                                                      | `WEBAUTHN2-7.2.12-01` | covered                                                                                                                                                                       |
| 7.2 step 13 | MUST   | the client data's `origin` matches the relying party's origin                                                                                         | `WEBAUTHN2-7.2.13-01` | covered                                                                                                                                                                       |
| 7.2 step 14 | MUST   | the client data's `tokenBinding.status` matches the state of Token Binding for the TLS connection                                                     | —                     | n/a: Token Binding (RFC 8471) was withdrawn by every browser that trialled it, so no `tokenBinding` member is ever present, and Odudu terminates no TLS connection to bind to |
| 7.2 step 15 | MUST   | the `rpIdHash` in the authenticator data is the SHA-256 hash of the RP ID the relying party expects                                                   | `WEBAUTHN2-7.2.15-01` | covered                                                                                                                                                                       |
| 7.2 step 16 | MUST   | the User Present bit of the authenticator data's flags is set                                                                                         | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 17 | MUST   | where user verification is required for the assertion, the User Verified bit is set                                                                   | `WEBAUTHN2-7.2.17-01` | covered                                                                                                                                                                       |
| 7.2 step 18 | MUST   | the client and authenticator extension outputs are as expected, unsolicited or absent ones included                                                   | —                     | n/a: the options request no extensions, so no output can differ from what was asked for; the parse boundary drops any that arrive                                             |
| 7.2 step 19 | MUST   | a SHA-256 hash is computed over the client data                                                                                                       | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu                                                                                                                 |
| 7.2 step 20 | MUST   | the signature is verified, with the credential public key, over the authenticator data concatenated with that hash                                    | —                     | n/a: performed by @simplewebauthn/server 14.0.2, not by Odudu; the key it checks against is the one enrolment stored (§7.2 step 7's row)                                      |
| 7.2 step 21 | MUST   | where either the asserted or the stored signature count is nonzero, the two are compared                                                              | `WEBAUTHN2-7.2.21-01` | covered                                                                                                                                                                       |
| 7.2 step 21 | MUST   | where the asserted count is greater than the stored one, the stored count is updated to it                                                            | `WEBAUTHN2-7.2.21-01` | covered                                                                                                                                                                       |
| 7.2 step 21 | SHOULD | where the asserted count is at or below the stored one, the possible cloning is taken into the relying party's risk scoring                           | `WEBAUTHN2-7.2.21-02` | covered                                                                                                                                                                       |
| 7.2 step 22 | MUST   | the authentication ceremony continues only where every step succeeded, and fails otherwise                                                            | `WEBAUTHN2-7.2.22-01` | covered                                                                                                                                                                       |

## Reading notes

### Attestation is not assessed

Eight rows point here, and they are one decision: Odudu asks for no
attestation and applies no authenticator-model policy. `create()`'s
options leave `attestation` at @simplewebauthn/server's default of
`'none'`, so a conforming client sends an attestation object with
`fmt: "none"` and an empty statement, and steps 18 to 21 have nothing to
assess: there is no signature over the credential that a certificate could
anchor, no `aaguid` worth reading, and no trust anchor list to obtain.
§7.1 step 21's first sub-step is the one that closes — "If no attestation
was provided, verify that None attestation is acceptable under Relying
Party policy" — because Odudu's policy is precisely that, and every
enrolment test drives a `none` attestation through to a stored credential.

What is deliberately given up is knowing _which model_ of authenticator
holds a credential: a deployment that must refuse, say, everything but a
certified hardware key needs steps 19 through 24, the FIDO Metadata
Service or an equivalent trust-anchor source behind them, and a policy to
express the answer in. Nothing in a passkey's security as a login factor
depends on it — the ceremony proves possession of the private key and, via
the User Verified flag, that the holder was verified, both of which are
checked and tested — so the rows are `accepted:` rather than deferred: no
phase is waiting to close them, and if one ever is, it arrives with an
attestation policy in the tenant's own configuration to hang them on.

### The assertion is resolved by credential id, not by user handle

§7.2 step 6 asks the relying party to identify the user and verify
ownership, and gives two branches. The second is the one a passkey login
with no username takes: "If the user was not identified before the
authentication ceremony was initiated, verify that `response.userHandle`
is present, and that the user identified by this value is the owner of
`credentialSource`." Odudu does not read `userHandle` at all.
`assertedCredentialId` (`service/webauthn.ts`) takes the response's
credential id, and a tenant-scoped read of `user_credentials.lookup_key`
resolves the row — subject included — before any signature is checked,
because `verifyAuthenticationResponse` needs the stored public key as an
input and so ownership has to be settled first.

The divergence is deliberate and narrow. `lookup_key` is unique per tenant,
so the id identifies exactly one credential and therefore exactly one
subject; the signature is then checked against _that_ row's public key, so
an assertion naming a credential id cannot be made to authenticate anybody
but its owner. What `userHandle` would add is a second, independent
statement of the same fact, and treating it as authoritative would be
worse: it is a value the authenticator stored and returns, so an
implementation that resolved the subject from it would be resolving a
login from a field it never checks a signature over. Enrolment does put
the subject id in the user handle, so the cross-check is available if a
later phase wants it as a belt-and-braces comparison rather than as the
resolution step. Registered as a divergence rather than a gap because
nothing is waiting to be built: the alternative was considered and this is
the answer.

### A credential id is refused tenant-wide, not just per user

§7.1 step 22 is scoped to another _user_: "Check that the `credentialId`
is not yet registered to any other user." Odudu's constraint is
`user_credentials_lookup_key`, which is unique per tenant, so a credential
id already held by the same subject is refused too — strictly stronger
than the step, and the direction that cannot go wrong. `excludeCredentials`
in the creation options (§7.1 step 1's row) is what stops a conforming
browser producing the collision in the first place; the unique index is
what catches it if one does anyway, and `already_enrolled` is what the
ceremony answers with.

### The counter refusal is Odudu's risk scoring

§7.2 step 21's second sub-step says what a counter that failed to advance
means — "a signal that the authenticator may be cloned" — and then leaves
the response open: "Whether the Relying Party updates `storedSignCount` in
this case, or not, or fails the authentication ceremony or not, is Relying
Party-specific." `counterAdvanced`
(`service/authenticators/passkey.ts`) fails the ceremony, with one
exception the step's own guard licenses: an authenticator that reports zero
and has always reported zero is accepted, because the comparison only runs
"if `authData.signCount` is nonzero or `storedSignCount` is nonzero", and
platform authenticators that keep no counter report zero for every
assertion forever. Refusing those would refuse every iCloud and Windows
Hello passkey; refusing nothing would drop the only clone signal WebAuthn
offers.
