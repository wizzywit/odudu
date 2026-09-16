# P2b spike log

Findings from spikes run during P2b's execution, recorded because the next
task acts on them without re-deriving them.

---

## user_credentials.secret_data to jsonb

**Question:** does
`ALTER TABLE user_credentials ALTER COLUMN secret_data TYPE jsonb USING jsonb_build_object('hash', secret_data)`
convert every existing Argon2id PHC string into `{"hash": "<string>"}`
without mangling it, on a real PostgreSQL 17, for inputs chosen to break it —
and is the conversion reversible?

**Answer: yes to both.** The expression is safe for every case probed,
including a hash containing `"`, `\`, `{`, `}`, an embedded newline, and the
empty string, and `secret_data->>'hash'` recovers the original text
byte-for-byte in every case.

### Setup

Probe built outside the repository, in `/tmp/jsonb-spike/` (deleted after
this run), against a real Postgres 17 container:

```bash
mkdir -p /tmp/jsonb-spike && cd /tmp/jsonb-spike
docker rm -f jsonb-spike 2>/dev/null
docker run -d --name jsonb-spike -e POSTGRES_PASSWORD=spike -p 55432:5432 postgres:17
sleep 4
docker exec jsonb-spike pg_isready -U postgres
```

Output:

```
32d2baec4e3272cc4f68467c8052fea0d4e57f20953b793f39b4d5155f74909b
/var/run/postgresql:5432 - accepting connections
```

`user_credentials` was recreated as `packages/db/drizzle/0005_subjects.sql`
actually defines it — `realm_id`, `subject_id`, the `type` `CHECK`, and the
`(subject_id, type)` unique constraint — not the brief's simplified
two-column sketch. The `subjects`/`realms` foreign keys were left out since
this spike is only about the column's type conversion, not referential
integrity, and standing those tables up would not have changed the answer.
An `original_secret_data` column was added and populated **before** the type
change specifically so the pre-conversion text would still be there to
compare against after `secret_data` becomes `jsonb` and the original text is
gone.

`setup.sql`:

```sql
CREATE TABLE user_credentials (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL,
  subject_id  uuid NOT NULL,
  type        text NOT NULL,
  secret_data text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_type_check CHECK (type IN ('password')),
  CONSTRAINT user_credentials_one_password UNIQUE (subject_id, type)
);

-- Row 1: brief's base64 row with + and /
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQrLy8=$aGFzaHZhbHVlL3dpdGgrc2xhc2hlcw==');

-- Row 2: brief's row containing a literal double quote and a backslash
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   '$argon2id$v=19$m=19456,t=2,p=1$YQ==$"quoted"\backslash');

-- Row 3: brief's row ending with a closing brace
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   '$argon2id$v=19$m=1$Yg==$ends-with-brace}');

-- Row 4: contains both a closing brace and an opening brace
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   '$argon2id$v=19$m=1$Yw==$has}both{braces');

-- Row 5: empty string
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password', '');

-- Row 6: a real Argon2id hash produced by @node-rs/argon2 (this repo's hashing code)
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   '$argon2id$v=19$m=19456,t=2,p=1$2Wn+8hSHJPI6rFuZxEuL6w$h6Kjk+NsAcFtTnM2/d9Z97rk3NOo7YNP427kEaZhBj8');

-- Row 7: contains an embedded newline. A real PHC string cannot contain one
-- (RFC 9106 / the PHC string format restrict every field to base64 and a
-- fixed ASCII parameter charset), but secret_data is plain `text`, so
-- nothing at the schema level stops one being written; probe it anyway.
INSERT INTO user_credentials (id, realm_id, subject_id, type, secret_data) VALUES
  (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'password',
   E'line-one\nline-two');

-- Keep the original text alongside so byte-identity can be checked AFTER
-- the column is converted to jsonb and the original text is gone.
ALTER TABLE user_credentials ADD COLUMN original_secret_data text;
UPDATE user_credentials SET original_secret_data = secret_data;
```

Row 6's hash was produced by this repository's own hashing code, not typed
by hand:

```bash
node -e "
const { hash } = require('@node-rs/argon2');
(async () => {
  const h = await hash('correct horse battery staple',
    { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  console.log(h);
})();
"
```

Output: `$argon2id$v=19$m=19456,t=2,p=1$2Wn+8hSHJPI6rFuZxEuL6w$h6Kjk+NsAcFtTnM2/d9Z97rk3NOo7YNP427kEaZhBj8`
— these are the exact parameters `packages/domain-identity/src/service/password.ts` uses.

```bash
docker exec -i jsonb-spike psql -U postgres < setup.sql
```

Output:

```
CREATE TABLE
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
ALTER TABLE
UPDATE 7
```

### Conversion

`convert.sql`:

```sql
ALTER TABLE user_credentials
  ALTER COLUMN secret_data TYPE jsonb
  USING jsonb_build_object('hash', secret_data);

SELECT id, secret_data, secret_data->>'hash' AS extracted FROM user_credentials ORDER BY id;
```

```bash
docker exec -i jsonb-spike psql -U postgres -x < convert.sql
```

Output (verbatim, 7 records):

```
ALTER TABLE
-[ RECORD 1 ]--------------------------------------------------------------------------------------------------------------
id          | 61979acf-8af1-4fa8-b5c5-e501839f3884
secret_data | {"hash": "$argon2id$v=19$m=1$Yg==$ends-with-brace}"}
extracted   | $argon2id$v=19$m=1$Yg==$ends-with-brace}
-[ RECORD 2 ]--------------------------------------------------------------------------------------------------------------
id          | 7dc793ec-ebd4-438c-bdb3-9fc64ec93291
secret_data | {"hash": "$argon2id$v=19$m=1$Yw==$has}both{braces"}
extracted   | $argon2id$v=19$m=1$Yw==$has}both{braces
-[ RECORD 3 ]--------------------------------------------------------------------------------------------------------------
id          | ade993aa-327e-44bc-953e-e1f4a3bacbca
secret_data | {"hash": "$argon2id$v=19$m=19456,t=2,p=1$2Wn+8hSHJPI6rFuZxEuL6w$h6Kjk+NsAcFtTnM2/d9Z97rk3NOo7YNP427kEaZhBj8"}
extracted   | $argon2id$v=19$m=19456,t=2,p=1$2Wn+8hSHJPI6rFuZxEuL6w$h6Kjk+NsAcFtTnM2/d9Z97rk3NOo7YNP427kEaZhBj8
-[ RECORD 4 ]--------------------------------------------------------------------------------------------------------------
id          | b97fb0f3-310b-429b-8b0a-06a0a0f828e6
secret_data | {"hash": "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQrLy8=$aGFzaHZhbHVlL3dpdGgrc2xhc2hlcw=="}
extracted   | $argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQrLy8=$aGFzaHZhbHVlL3dpdGgrc2xhc2hlcw==
-[ RECORD 5 ]--------------------------------------------------------------------------------------------------------------
id          | cb2b52c1-31ca-419d-8d69-4dd085c651b9
secret_data | {"hash": "$argon2id$v=19$m=19456,t=2,p=1$YQ==$\"quoted\"\\backslash"}
extracted   | $argon2id$v=19$m=19456,t=2,p=1$YQ==$"quoted"\backslash
-[ RECORD 6 ]--------------------------------------------------------------------------------------------------------------
id          | e4c91049-1279-4c0d-8314-a5e20f6e26d5
secret_data | {"hash": "line-one\nline-two"}
extracted   | line-one                                                                                                     +
            | line-two
-[ RECORD 7 ]--------------------------------------------------------------------------------------------------------------
id          | f10f4930-0e90-43b9-aed4-2e8f4add47fa
secret_data | {"hash": ""}
extracted   |
```

`jsonb_build_object` escaped the embedded quote, backslash, and newline
correctly inside the JSON string; the literal `{` and `}` characters needed
no escaping since they are just ordinary characters inside a JSON string
value, not structural JSON. The empty string round-tripped to `{"hash": ""}`
and `secret_data->>'hash'` on it returns an empty string, not `NULL` — a
credential row that somehow had an empty `secret_data` before the migration
stays exactly as empty afterwards, it does not start authenticating
differently.

### Byte-identity check

Measured with a query, before the type-changing `ALTER` discarded the
original text — the `original_secret_data` column captured in `setup.sql`
is what makes this possible after the fact:

```bash
docker exec -i jsonb-spike psql -U postgres -c \
  "SELECT count(*) AS total,
          count(*) FILTER (WHERE secret_data->>'hash' = original_secret_data) AS matching,
          count(*) FILTER (WHERE secret_data->>'hash' IS DISTINCT FROM original_secret_data) AS mismatched
   FROM user_credentials;"
```

Output:

```
 total | matching | mismatched
-------+----------+------------
     7 |        7 |          0
(1 row)
```

Also checked octet length, in case Postgres text equality masked an
encoding-level difference:

```bash
docker exec -i jsonb-spike psql -U postgres -c \
  "SELECT count(*) FILTER (WHERE octet_length(secret_data->>'hash') != octet_length(original_secret_data)) AS length_mismatches FROM user_credentials;"
```

Output:

```
 length_mismatches
-------------------
                 0
(1 row)
```

The brief's own sanity check, adjusted to the row count actually seeded:

```bash
docker exec -i jsonb-spike psql -U postgres -c \
  "SELECT count(*) FROM user_credentials WHERE secret_data->>'hash' LIKE '\$argon2id\$%';"
```

Output: `5` — the five rows that are real PHC-shaped strings (rows 1–4 and
6; the empty string and the plain newline text are not PHC strings and
correctly do not match).

**Result: 7 total, 7 matching, 0 mismatched, 0 length mismatches.** The
conversion is byte-identical for every case probed.

### Teardown

```bash
docker rm -f jsonb-spike && rm -rf /tmp/jsonb-spike
```

### Findings for Task 12

- **`verified: jsonb_build_object('hash', secret_data)`** is the exact
  `USING` expression to write in the migration. No cast, no
  `to_jsonb`/string-wrapping workaround needed — `jsonb_build_object`
  already produces a JSON object with the raw text as the value of `hash`,
  correctly escaped, for every character class a PHC string or a corrupted
  row could contain.
- **The conversion is reversible.** Since `secret_data->>'hash'` recovers
  the original byte-for-byte in every case tested, a down-migration
  `ALTER TABLE user_credentials ALTER COLUMN secret_data TYPE text USING secret_data->>'hash'`
  is safe to write and is not a one-way door.
- A PHC string cannot contain a newline in practice — the PHC string format
  restricts every field to a fixed ASCII/base64 charset with no control
  characters — but `secret_data` is plain `text` today, so nothing stops a
  corrupted or hand-inserted row from carrying one. The conversion handles
  that case correctly anyway (row 7 above), so it is not a hazard for this
  migration specifically, only a reminder that `secret_data` has never been
  validated against the PHC grammar at the database level.
- An empty `secret_data` round-trips to `{"hash": ""}`, not `{"hash": null}`
  or a JSON error. If an empty string can occur in a real deployment (it
  should not, given `secret_data text NOT NULL` and application code that
  always calls `hashPassword`), the migration does not make it worse or
  better — it is preserved as-is either way.
- The brief's three rows were insufficient to rule out escaping bugs in
  `jsonb_build_object` around brace characters and control characters
  specifically, since none of its three rows exercised an unescaped `{` or a
  raw newline; both were added here and both passed.

---

## @simplewebauthn/server: API surface and usernameless assertions

**Questions:** (1) is `@simplewebauthn/server`'s API at the version we'd pin
the API its documentation describes? (2) can a discoverable-credential
assertion be completed with no username — `generateAuthenticationOptions`
called with no `allowCredentials`, and the verified assertion identifying
the credential well enough to resolve a subject from `lookup_key` alone?

**Answer to (1): yes**, with one packaging detail the brief's own probe
command got wrong. **Answer to (2): yes**, but with a load-bearing
qualification: `verifyAuthenticationResponse` requires the credential
record as an *input*, so subject resolution must happen from the raw
assertion **before** verification, not from anything the verified result
hands back. Both the credential ID and a user handle are available on the
raw response for that purpose.

### Setup

Probe built outside the repository, in
`/private/tmp/claude-202959266/-Users-wep-WebstormProjects-odudu/964a2d87-083e-4182-b760-d540f5e5eb4f/scratchpad/webauthn-spike/`
(the brief names `/tmp/webauthn-spike`; this session used its own scratchpad
directory for the same throwaway purpose), deleted after this run.

```bash
mkdir -p webauthn-spike && cd webauthn-spike
npm init -y >/dev/null
npm i @simplewebauthn/server
node -e "console.log(require('./package.json').dependencies)"
```

Output:

```
added 25 packages, and audited 26 packages in 4s
found 0 vulnerabilities
{ '@simplewebauthn/server': '^14.0.2' }
```

`package.json` records a caret range; the installed version is resolved
explicitly:

```bash
node -e "console.log(require('./node_modules/@simplewebauthn/server/package.json').version)"
```

Output: `14.0.2`

**`14.0.2` is the version Task 18 pins.**

### Step 2: API surface actually exported

```bash
node --input-type=module -e "
import * as s from '@simplewebauthn/server';
console.log(Object.keys(s).sort().join('\n'));
"
```

Output (an `ExperimentalWarning` about the Web Crypto API and ML-DSA-44
trimmed — Node's own warning about its WebCrypto implementation, unrelated
to this library):

```
BaseMetadataService
MetadataService
PQCNotSupportedError
SettingsService
SimpleWebAuthnError
defaultSupportedAlgorithmIDs
generateAuthenticationOptions
generateRegistrationOptions
verifyAuthenticationResponse
verifyRegistrationResponse
```

All four functions the brief expected are present and exported exactly as
named: `generateRegistrationOptions`, `verifyRegistrationResponse`,
`generateAuthenticationOptions`, `verifyAuthenticationResponse`. Nothing
documented is missing. The extra exports (`MetadataService`,
`SettingsService`, `SimpleWebAuthnError`, `PQCNotSupportedError`,
`defaultSupportedAlgorithmIDs`) are FIDO metadata-service and error-type
surface not needed for this design.

One thing the brief's own Step 4 command got wrong, caught only by running
it: it assumes `node_modules/@simplewebauthn/server/dist/index.d.ts`. That
path does not exist in `14.0.2` — there is no `dist/` directory at all. The
package ships parallel `esm/` and `script/` trees instead:

```bash
node -e "const p=require('./node_modules/@simplewebauthn/server/package.json'); console.log(JSON.stringify({main:p.main, module:p.module, exports:p.exports},null,2))"
```

Output:

```json
{
  "main": "./script/index.js",
  "module": "./esm/index.js",
  "exports": {
    ".": {
      "import": "./esm/index.js",
      "require": "./script/index.js"
    },
    "./helpers": {
      "import": "./esm/helpers/index.js",
      "require": "./script/helpers/index.js"
    }
  }
}
```

Declarations live at `esm/index.d.ts` and `esm/authentication/*.d.ts` (and
mirrored under `script/`), not `dist/index.d.ts`. This is exactly the shape
of drift the P0 rule exists to catch: the brief's plan-level claim about a
file path was reasonable and wrong, and only running the command surfaced
it.

### Step 3: usernameless option shape

```bash
node --input-type=module -e "
import { generateAuthenticationOptions } from '@simplewebauthn/server';
const options = await generateAuthenticationOptions({ rpID: 'localhost' });
console.log(JSON.stringify(options, null, 2));
"
```

Output (the same Node WebCrypto `ExperimentalWarning` trimmed):

```json
{
  "rpId": "localhost",
  "challenge": "wdicJ55xIo6rNhpRDBnU5ZlS3P-tAzATzb9GkrHqkZQ",
  "timeout": 60000,
  "userVerification": "preferred"
}
```

The call succeeds with no `allowCredentials` argument, and the returned
options **omit the key entirely** rather than returning it empty — the
strongest form of the brief's "yes" criterion. This is what tells a browser
to offer every discoverable credential it holds rather than restricting the
prompt to a known list.

### Step 4: what `verifyAuthenticationResponse` requires and returns

Read from the declaration file directly (`esm/authentication/verifyAuthenticationResponse.d.ts`
— see the packaging note above for why this path, not `dist/index.d.ts`):

```bash
cat node_modules/@simplewebauthn/server/esm/authentication/verifyAuthenticationResponse.d.ts
```

Relevant excerpt, verbatim:

```typescript
export declare function verifyAuthenticationResponse(options: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string | ((challenge: string) => boolean | Promise<boolean>);
    expectedOrigin: string | string[];
    expectedRPID: string | string[];
    credential: WebAuthnCredential;
    expectedType?: string | string[];
    expectedTopOrigin?: string | string[];
    requireUserVerification?: boolean;
    advancedFIDOConfig?: {
        userVerification?: UserVerificationRequirement;
    };
}): Promise<VerifiedAuthenticationResponse>;

export type VerifiedAuthenticationResponse = {
    verified: boolean;
    authenticationInfo: {
        credentialID: Base64URLString;
        newCounter: number;
        userVerified: boolean;
        credentialDeviceType: CredentialDeviceType;
        credentialBackedUp: boolean;
        origin: string;
        rpID: string;
        authenticatorExtensionResults?: AuthenticationExtensionsAuthenticatorOutputs;
    };
};
```

`credential` is **not optional** — `WebAuthnCredential` has no `?` and is
listed alongside the other required fields. Its own shape, from the same
`types/index.d.ts`:

```typescript
export type WebAuthnCredential = {
    id: Base64URLString;
    publicKey: Uint8Array_;
    counter: number;
    transports?: string[];
};
```

So the function demands the caller supply the stored credential record
(public key and last-known counter) up front. There is no lookup-by-ID
performed inside the library — **subject and credential resolution must
happen before this call, from the raw assertion**, not from anything
`verifyAuthenticationResponse` returns.

The raw assertion the browser sends, before verification, is
`AuthenticationResponseJSON` (`esm/types/index.d.ts`):

```typescript
export interface AuthenticationResponseJSON {
    id: Base64URLString;
    rawId: Base64URLString;
    response: AuthenticatorAssertionResponseJSON;
    authenticatorAttachment?: AuthenticatorAttachment;
    clientExtensionResults: AuthenticationExtensionsClientOutputs;
    type: PublicKeyCredentialType;
}

export interface AuthenticatorAssertionResponseJSON {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString;
}
```

and `Base64URLString` is a plain alias, confirmed in the same file:

```bash
grep -n "^export type Base64URLString" node_modules/@simplewebauthn/server/esm/types/dom.d.ts
```

Output: `export type Base64URLString = string;`

So **two independent fields on the raw, pre-verification response can
resolve a subject**:

- `response.id` (and identically, `response.rawId`) — the credential ID, a
  base64url-encoded **string**. This is the natural key to look up
  `lookup_key` against.
- `response.response.userHandle` — an **optional** base64url-encoded
  string, present only when the authenticator returns one. This is the
  user-handle path WebAuthn defines as the alternative resolution
  mechanism for discoverable credentials.

Once resolved, the caller passes the matching `WebAuthnCredential` (id,
stored public key, stored counter) into `verifyAuthenticationResponse`, and
only then finds out whether the signature actually verifies.

On success, `authenticationInfo` hands back both fields Task 19 needs:
`credentialID` (`Base64URLString`, i.e. the same base64url string) to
confirm/re-key which credential authenticated, and `newCounter` (`number`)
to compare against the stored counter and detect a cloned authenticator.

### Teardown

```bash
rm -rf webauthn-spike
```

### Findings for Task 18/19

**Conclusion 1 (API surface — executed, `Object.keys` output above):**
**Yes**, `@simplewebauthn/server@14.0.2`'s exported API matches its
documentation — all four functions the docs describe
(`generateRegistrationOptions`, `verifyRegistrationResponse`,
`generateAuthenticationOptions`, `verifyAuthenticationResponse`) are present
under those exact names, nothing documented is missing. The one drift
found was packaging, not API: the library ships declarations under
`esm/`/`script/`, not `dist/`, which is a detail for how Task 18 points its
editor/IDE at the types, not a behavioural surprise.

**Conclusion 2 (usernameless assertion — executed for the options call,
read from `.d.ts` declarations for the verify call's contract):** **Yes,
a discoverable-credential, usernameless first-factor assertion is
supportable**, but not by treating "call verify and see what comes back"
as the resolution point. `generateAuthenticationOptions({ rpID })` with no
`allowCredentials` succeeds and omits the key from its output (executed,
Step 3) — the browser side of usernameless is confirmed live. On the
verify side (read from types, not executed — no browser ceremony was run
against this probe), `verifyAuthenticationResponse` **requires** a
`WebAuthnCredential` as input, so **subject resolution must happen before
verification**, from the raw `AuthenticationResponseJSON`: `id`/`rawId`
(a base64url string) is always present and is the primary lookup key
against `lookup_key`; `response.userHandle` (also a base64url string) is
present only when the authenticator supplies one and is the fallback/second
path WebAuthn defines for the same resolution. Post-verification,
`authenticationInfo.credentialID` and `authenticationInfo.newCounter` are
both returned, confirming Task 19 can update the stored counter after the
fact for clone detection.

**No spec change needed.** Section 5.2's usernameless first-factor design
is executable as specified — Task 19's implementation shape is: resolve
`lookup_key` from `response.id` (or `response.response.userHandle` as a
fallback) *before* calling `verifyAuthenticationResponse`, supply the
resolved `WebAuthnCredential` to it, then persist `newCounter` from the
result against that same credential row.

**Evidence boundary.** What is executed, not merely read: the resolved
version; the full list of live exports; the live, no-argument
`generateAuthenticationOptions` call and its output showing `allowCredentials`
absent. What is read from `.d.ts` declarations, not executed — no browser
WebAuthn ceremony was run, so nothing here proves an actual authenticator's
JSON payload matches these shapes at runtime, only that the library's own
compiled type contract requires and returns them: the mandatory `credential`
parameter on `verifyAuthenticationResponse`, the `AuthenticationResponseJSON`/
`AuthenticatorAssertionResponseJSON` field shapes (`id`, `rawId`,
`userHandle`, all `Base64URLString` = `string`), and the `VerifiedAuthenticationResponse`
result shape (`credentialID`, `newCounter`). A real ceremony — Task 19's own
integration test — is the point at which this becomes executed evidence
rather than declared contract.
