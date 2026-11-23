# Verification fixtures

The keys here are test keys. `keys.json` holds their private halves and is
committed on purpose; it protects nothing. Never trust a key from this folder.

`generate.ts` rewrites every file beside it. With `keys.json` present the output
is byte-stable: RS256 signatures are deterministic, and the ES256 token is kept from the `cases.json` already on disk (ECDSA signatures are random) as long as it verifies under `key-3`; replace `key-3` and the token is signed again. Delete both files to start over.

```sh
node --experimental-strip-types generate.ts
pnpm exec prettier --write .
```

- `jwks.json`: the public keys `key-1` and `key-2`, as an issuer would publish them.
- `cases.json`: an array of verdicts, readable by any language's verifier.

## `cases.json`

Each case is an object:

| Field           | Meaning                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `name`          | What the case shows.                                                      |
| `token`         | The compact JWT, or a string that is not one.                             |
| `issuer`        | The one issuer the verifier trusts.                                       |
| `audience`      | The audience of the API verifying.                                        |
| `requiredScope` | Optional. The scope the API demands.                                      |
| `now`           | The verifier's clock, in milliseconds since the epoch. Use it, not today. |
| `expected`      | The verdict, below.                                                       |

`expected` is `{ "ok": true, "scope": [...] }` when the token is accepted. Otherwise
it is `{ "ok": false, "status": 401 | 403, "code": "invalid_token" |
"insufficient_scope", "reason": "..." }`. `status` and `code` are the contract; `reason`
names the check that refused and is there so a case cannot pass by failing for
another cause. The JWKS to serve is `jwks.json`, at the `jwks_uri` of the issuer's
discovery document. A verifier refuses a `jwks_uri` that is not https when its issuer
is https; only an http development issuer may name an http one, and only on its own origin.

## Clock tolerance

A verifier applies 5 seconds of leeway to `exp` and `nbf`. That is a deliberate
deviation from the server, which applies none; every verifier reading these cases
must use the same value, because the `expired 4 s ago` / `6 s ago` and
`valid in 4 s` / `6 s` cases sit on either side of it. Matching is otherwise the
server's: `typ` must equal `at+jwt` exactly (`AT+JWT` and `application/at+jwt`
are refused) and only RS256 and ES256 are accepted.
