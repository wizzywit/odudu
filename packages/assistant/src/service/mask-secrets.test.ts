import type { JsonValue } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { createMasker, MASKED, maskSecrets } from '#/service/mask-secrets';

const SECRET = 'q7Zk3vN0pX2mB9sT4wY8uR1eC6hJ5aLdF0gHiKoPz_-';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXBhcnQ';

describe('maskSecrets', () => {
  it('masks a member that holds a secret, at any depth', () => {
    const out = maskSecrets({
      data: { client_id: 'c1', client_secret: SECRET, nested: [{ password_hash: 'x' }] },
    });
    expect(out).toEqual({
      data: { client_id: 'c1', client_secret: MASKED, nested: [{ password_hash: MASKED }] },
    });
  });

  it.each([
    'client_secret',
    'client_secrets',
    'registration_access_token',
    'access_token',
    'refresh_token',
    'id_token',
    'password',
    'password_hash',
    'secret_hash',
    'previous_secret_hash',
    'private_jwk_encrypted',
    'recovery_codes',
    'totp_secret',
    'api_key',
    'Authorization',
    'set-cookie',
  ])('masks the member %s whatever it holds', (key) => {
    expect(maskSecrets({ [key]: { a: ['one', 2] } })).toEqual({ [key]: MASKED });
    expect(maskSecrets({ [key]: 'value-here' })).toEqual({ [key]: MASKED });
  });

  it('masks the private members of a JWK and keeps the public ones', () => {
    const jwk: JsonValue = {
      kty: 'RSA',
      kid: 'k1',
      n: 'abc',
      e: 'AQAB',
      d: 'priv',
      p: 'p',
      qi: 'q',
    };
    expect(maskSecrets(jwk)).toEqual({
      kty: 'RSA',
      kid: 'k1',
      n: 'abc',
      e: 'AQAB',
      d: MASKED,
      p: MASKED,
      qi: MASKED,
    });
  });

  it('masks the private members of a JWK held in JSON text, and only in the key', () => {
    const text =
      '<tool-data>{"d":"day","keys":[{"kid":"k1","kty":"RSA","n":"mod","e":"AQAB","d":"priv-d",' +
      '"p":"priv-p","dq":"priv-dq"},{"kty":"EC","crv":"P-256","x":"px","d":"ec-d"}],"q":"quick"}</tool-data>';
    const out = maskSecrets(text);
    expect(out).toBe(
      '<tool-data>{"d":"day","keys":[{"kid":"k1","kty":"RSA","n":"mod","e":"AQAB","d":"[masked]",' +
        '"p":"[masked]","dq":"[masked]"},{"kty":"EC","crv":"P-256","x":"px","d":"[masked]"}],"q":"quick"}</tool-data>',
    );
  });

  it('leaves a member named d alone when the object is not a key', () => {
    expect(maskSecrets({ d: 'day' })).toEqual({ d: 'day' });
  });

  it('masks a secret held in JSON text, plain and escaped', () => {
    const plain = `<data>{"client_id":"c1","client_secret":"${SECRET}","n":1}</data>`;
    const escaped = `{"text":"{\\"client_secret\\":\\"${SECRET}\\"}"}`;
    expect(maskSecrets(plain)).toBe(
      `<data>{"client_id":"c1","client_secret":"${MASKED}","n":1}</data>`,
    );
    expect(maskSecrets(escaped)).not.toContain(SECRET);
  });

  it('masks a whole array held under a secret member of JSON text', () => {
    const text = `{"client_secrets":[{"client_id":"a","client_secret":"zzzzzzzz1"}],"after":true}`;
    expect(maskSecrets(text)).toBe(`{"client_secrets":"${MASKED}","after":true}`);
  });

  it.each([
    ['a JWT', `the token ${JWT} was issued`],
    ['a PEM block', '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----'],
    ['an argon2 hash', 'hash $argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo'],
    ['a bcrypt hash', 'hash $2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'],
    ['a long random token', `it is ${SECRET} now`],
  ])('masks %s in free text', (_name, text) => {
    const out = maskSecrets(text);
    expect(typeof out).toBe('string');
    expect(out).toContain(MASKED);
    expect(out).not.toMatch(
      /Bearer abc|eyJhbGci|MIIEvQ|aGFzaGhhc2g|abcdefghijklmnopqrstuu|q7Zk3v/u,
    );
  });

  it.each([
    ['client_secret=hunter2hunter2 and more', 'client_secret=[masked]'],
    ['failed with password: "pa ss" now', 'failed with password: "[masked]" now'],
    ["api-key = 'k-1234567'", "api-key = '[masked]'"],
  ])('masks the value of a secret named in an error or a header: %s', (text, expected) => {
    expect(maskSecrets(text)).toBe(expected);
  });

  // The token itself, never only its prefix, is what must be gone.
  it.each([
    ['a header', 'curl -H "Authorization: Bearer abc.def-ghi_jkl123456"', 'abc.def-ghi_jkl123456'],
    ['a header line', 'Authorization: Bearer abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
    ['an assignment', 'authorization=Bearer abc1234xyz', 'abc1234xyz'],
    ['basic credentials', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
    ['JSON text', '{"authorization":"Bearer abc1234xyz","n":1}', 'abc1234xyz'],
    ['escaped JSON text', '{"t":"{\\"authorization\\":\\"Bearer abc1234xyz\\"}"}', 'abc1234xyz'],
    ['prose', 'it was sent as Bearer 8f3a9c2d1e', '8f3a9c2d1e'],
  ])('leaves no part of the token of %s', (_name, text, token) => {
    const out = maskSecrets(text);
    expect(out).not.toContain(token);
    expect(out).toContain(MASKED);
  });

  it('leaves the word Bearer alone in prose', () => {
    for (const text of [
      'sent as a Bearer token',
      'Bearer authentication is used',
      'a bearer scheme',
    ]) {
      expect(maskSecrets(text)).toBe(text);
    }
  });

  it.each([
    ['{"clientSecret":"Sup3rS3cretValue123"}', 'Sup3rS3cretValue123'],
    ['{"new_password":"Hunter2Hunter2!"}', 'Hunter2Hunter2!'],
    ['{"x-api-key":"k-9999-aaaa"}', 'k-9999-aaaa'],
    ['{"session_token":"st-5555-bbbb"}', 'st-5555-bbbb'],
    ['{"accessToken":"at-7777-cccc"}', 'at-7777-cccc'],
    ['{"backup_key":"bk-1111-dddd"}', 'bk-1111-dddd'],
    ['client_secret_value=csv-2222-eeee', 'csv-2222-eeee'],
  ])('masks a member named in an unusual way: %s', (text, value) => {
    expect(maskSecrets(text)).not.toContain(value);
  });

  it('masks object members by the same names, however they are written', () => {
    const out = maskSecrets({
      clientSecret: 'a',
      'x-api-key': 'b',
      sessionToken: 'c',
      db_password: 'd',
      signing_key: 'e',
      etag_hash: 'f',
    });
    expect(Object.values(out as Record<string, string>)).toEqual(Array(6).fill(MASKED));
  });

  it('keeps members that only look like secrets', () => {
    const value: JsonValue = {
      input_tokens: 5,
      output_tokens: 3,
      tokens: 900,
      public_key: 'pk',
      kid: 'k1',
      keys: 2,
      prompt: 'x',
    };
    expect(maskSecrets(value)).toEqual(value);
  });

  it('masks a 32 character run of mixed case and digits, and keeps a UUID', () => {
    expect(maskSecrets('tok aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH end')).toContain(MASKED);
    expect(maskSecrets('id 6f1e2d3c-1111-4222-8333-944455556666')).toContain('6f1e2d3c');
  });

  it.each([
    ['Cookie: theme=dark; sid=abc123def', 'Cookie: theme=[masked]; sid=[masked]'],
    ['Set-Cookie: sid=abc123def; Path=/; HttpOnly', 'Set-Cookie: sid=[masked]; Path=/; HttpOnly'],
    ['cookie: a=1; b=22', 'cookie: a=[masked]; b=[masked]'],
  ])('masks every cookie pair and keeps the names: %s', (text, expected) => {
    expect(maskSecrets(text)).toBe(expected);
  });

  // JSON carries its strings with escapes; a value is read to its real end.
  it.each([
    ['{"password": "ab\\"cd-tail-secret"}', 'cd-tail-secret'],
    ['{"client_secret":"x\\\\y-back-secret"}', 'y-back-secret'],
    ['{"error":{"client_secret":"q\\"r-tail-two"},"n":1}', 'r-tail-two'],
    ['{"t":"{\\"password\\":\\"p\\\\\\"w-tail-three\\"}"}', 'w-tail-three'],
  ])('reads an escaped quote or backslash inside a secret value: %s', (text, tail) => {
    const out = maskSecrets(text);
    expect(out).not.toContain(tail);
    expect(out).toContain(MASKED);
  });

  // The scheme is not case sensitive, the credential may be quoted, and the
  // header may arrive percent-encoded.
  it.each([
    ['authorization = bearer abc123def', 'abc123def'],
    ['Authorization: BEARER abc123def456', 'abc123def456'],
    ['Authorization: Bearer "abc123xyz"', 'abc123xyz'],
    ["Authorization: Token 'abc123xyz'", 'abc123xyz'],
    ['Authorization: Digest username="u", response="r3sp0nse"', 'r3sp0nse'],
    ['bearer abcdefgh1234', 'abcdefgh1234'],
    ['Authorization%3A%20Bearer%20abc123def456', 'abc123def456'],
    ['access_token%3Dabc123def456&x=1', 'abc123def456'],
    ['?client_secret=abc123def456&y=1', 'abc123def456'],
  ])('leaves no part of the credential in %s', (text, token) => {
    const out = maskSecrets(text);
    expect(out).not.toContain(token);
    expect(out).toContain(MASKED);
  });

  // A value cut off mid-way is masked to the end: what follows may be the rest of it.
  it.each([
    '{"password": "abcdef-trunc',
    '{"password": ["abc", "def"',
    '{"a":{"client_secret": {"k": "v',
    'error body: {"client_secret":"abcdef',
    'password="abc def',
    'password=\\"abc \\\\ def',
  ])('masks a truncated value to the end: %s', (text) => {
    const out = maskSecrets(text);
    expect(out).toContain(MASKED);
    expect(out).not.toMatch(/abcdef|abc def|\bdef\b|\bv\b/u);
  });

  it('reads a member name of any length', () => {
    const name = `${'very_long_'.repeat(12)}token`;
    expect(maskSecrets(`${name}=abc123def456 ok`)).toBe(`${name}=${MASKED}`);
  });

  it.each(['pwd', 'sig', 'signature', 'privateKey', 'apikey', 'x-api-key'])(
    'masks a member named %s',
    (name) => {
      expect(maskSecrets({ [name]: 'value-1' })).toEqual({ [name]: MASKED });
    },
  );

  it('keeps members that are about a secret and hold none', () => {
    const value: JsonValue = {
      token_type: 'Bearer',
      token_count: 3,
      token_endpoint_auth_method: 'client_secret_basic',
      password_policy: { min_length: 12, require_digit: true },
      client_secret_expires_at: 0,
      access_token_ttl: 300,
    };
    expect(maskSecrets(value)).toEqual(value);
  });

  it('keeps the shape of JSON text it does not change, and masks it by member', () => {
    const text = '{\n  "a": 1,\n  "b": [ 1, 2 ]\n}';
    expect(maskSecrets(text)).toBe(text);
  });

  it('keeps ordinary text, identifiers and hex digests', () => {
    const text = 'Client 6f1e2d3c-1111-4222-8333-944455556666 uses sha256 ' + 'ab12'.repeat(16);
    expect(maskSecrets(text)).toBe(text);
  });

  it('does not change a value with nothing to hide', () => {
    const value: JsonValue = { a: [1, true, null, 'x'], b: { c: 'd' } };
    expect(maskSecrets(value)).toEqual(value);
  });

  it('cuts a document nested beyond reason instead of walking it', () => {
    let deep: JsonValue = 'leaf';
    for (let i = 0; i < 100; i += 1) deep = { next: deep };
    expect(JSON.stringify(maskSecrets(deep))).toContain(MASKED);
  });
});

describe('createMasker', () => {
  it('does not learn from prose, so text another person wrote cannot steer what is masked', () => {
    const masker = createMasker({ emails: false });
    masker.mask('a group named password: required-field and token: policy-allowed');
    expect(masker.mask('A required-field is policy-allowed')).toBe(
      'A required-field is policy-allowed',
    );
  });

  it('does not learn a short value held under a secret member', () => {
    const masker = createMasker({ emails: false });
    masker.mask({ client_secret: 'a', password: 'true', token: 'short' });
    expect(masker.mask('a true short')).toBe('a true short');
  });

  it('keeps what it learned out of server-written records', () => {
    const masker = createMasker({ emails: false });
    masker.mask({ client_secret: 'standard-slot-name' });
    expect(masker.mask('uses standard-slot-name')).toBe(`uses ${MASKED}`);
    expect(masker.maskRecord({ slot: 'standard-slot-name', outcome: 'allowed' })).toEqual({
      slot: 'standard-slot-name',
      outcome: 'allowed',
    });
  });

  it('still masks the shapes and members in a server-written record', () => {
    const masker = createMasker({ emails: false });
    expect(masker.maskRecord({ note: `Bearer abc1234xyz`, secret: 'x' })).toEqual({
      note: `Bearer ${MASKED}`,
      secret: MASKED,
    });
  });

  it('learns a secret it is told of while the turn runs', () => {
    const masker = createMasker({ emails: false });
    masker.know('minted-access-token-123');
    expect(masker.mask('it said minted-access-token-123')).toBe(`it said ${MASKED}`);
  });

  it('learns from the secrets the server holds', () => {
    const masker = createMasker({ emails: false, known: ['server-held-secret-value'] });
    expect(masker.mask('it said server-held-secret-value')).toBe(`it said ${MASKED}`);
  });

  it('bounds what it remembers: the number of values and their total size', () => {
    const masker = createMasker({ emails: false });
    for (let i = 0; i < 300; i += 1)
      masker.mask({ client_secret: `value-number-${String(i).padStart(4, '0')}` });
    // The first values are kept, the ones past the bound are not.
    expect(masker.mask('value-number-0000')).toBe(MASKED);
    expect(masker.mask('value-number-0299')).toBe('value-number-0299');
    masker.mask({ client_secret: 'y'.repeat(100_000) });
  });

  it('masks a value it saw under a secret member wherever it turns up later', () => {
    const masker = createMasker({ emails: false });
    masker.mask({ client_secret: 'short-secret-1' });
    expect(masker.mask('Your secret is short-secret-1, keep it safe')).toBe(
      `Your secret is ${MASKED}, keep it safe`,
    );
    expect(masker.mask({ input: { note: 'short-secret-1' } })).toEqual({ input: { note: MASKED } });
  });

  it('learns from JSON text too', () => {
    const masker = createMasker({ emails: false });
    masker.mask('{"client_secret":"abc-learned-9"}');
    expect(masker.mask('the model said abc-learned-9')).toBe(`the model said ${MASKED}`);
  });

  it('learns each value of an array held under a secret member of JSON text', () => {
    const masker = createMasker({ emails: false });
    masker.mask('{"recovery_codes":["rc-abc-123456","rc-def-654321"]}');
    expect(masker.mask('codes rc-abc-123456 and rc-def-654321')).toBe(
      `codes ${MASKED} and ${MASKED}`,
    );
  });

  it('masks email addresses when the tenant masks them, and only then', () => {
    const on = createMasker({ emails: true });
    const off = createMasker({ emails: false });
    expect(on.mask({ who: 'ada@example.com' })).toEqual({ who: 'a***@example.com' });
    expect(off.mask({ who: 'ada@example.com' })).toEqual({ who: 'ada@example.com' });
  });
});

describe('the cost of masking', () => {
  // Generous headroom: a linear scan takes a few milliseconds, a quadratic one
  // over this input took close to a second.
  const LIMIT_MS = 150;
  const hostile = [
    '"secret":['.repeat(6_000),
    '"kty"'.repeat(12_000),
    '{"kty":'.repeat(8_000),
    '\\"token\\":['.repeat(5_000),
    'password:'.repeat(8_000),
  ];

  it.each(hostile.map((text, i) => [i, text] as const))(
    'masks 64 KiB of hostile text %i in the time of a linear scan',
    (_i, text) => {
      const started = performance.now();
      const out = maskSecrets(text);
      expect(typeof out).toBe('string');
      expect(performance.now() - started).toBeLessThan(LIMIT_MS);
    },
  );

  it('does the same for the 8 KiB an event holds', () => {
    for (const text of hostile) {
      const started = performance.now();
      maskSecrets(text.slice(0, 8_192));
      expect(performance.now() - started).toBeLessThan(LIMIT_MS);
    }
  });
});

describe('deep nesting', () => {
  const arrays = `${'['.repeat(10_000)}${']'.repeat(10_000)}`;
  const objects = `${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}`;

  it.each([
    ['arrays', arrays],
    ['objects', objects],
  ])('does not throw on 10,000 levels of %s in a string, and masks it whole', (_name, deep) => {
    expect(maskSecrets(deep)).toContain(MASKED);
    expect(JSON.stringify(maskSecrets({ a: deep }))).toContain(MASKED);
    expect(maskSecrets(JSON.stringify({ a: deep }))).toContain(MASKED);
  });

  it('keeps masking the rest of an object when one member is that deep', () => {
    const out = maskSecrets({
      deep: arrays,
      client_secret: 'abc',
      ok: 'plain text',
      n: 1,
    }) as Record<string, string>;
    expect(out.client_secret).toBe(MASKED);
    expect(out.ok).toBe('plain text');
    expect(out.n).toBe(1);
  });

  it('does not throw on an object nested 10,000 levels', () => {
    let deep: JsonValue = 'leaf';
    for (let i = 0; i < 10_000; i += 1) deep = { next: deep };
    expect(JSON.stringify(maskSecrets(deep))).toContain(MASKED);
  });
});

describe('connection strings and URLs', () => {
  it.each([
    [
      'https://user:S3cr3tValueXyz9@host/path',
      'S3cr3tValueXyz9',
      'https://user:[masked]@host/path',
    ],
    ['postgres://app:hunter2@db:5432/odudu', 'hunter2', 'postgres://app:[masked]@db:5432/odudu'],
    ['redis://:hunter2@cache:6379', 'hunter2', 'redis://:[masked]@cache:6379'],
    ['amqp://guest:hunter2@mq/vhost?x=1', 'hunter2', 'amqp://guest:[masked]@mq/vhost?x=1'],
    [
      'mongodb+srv://u:hunter2@cluster.example.net/db',
      'hunter2',
      'mongodb+srv://u:[masked]@cluster.example.net/db',
    ],
    [
      'connect failed: postgres://app:p@ss@db/odudu refused',
      'p@ss',
      'connect failed: postgres://app:[masked]@db/odudu refused',
    ],
  ])('masks the password in %s and keeps the user and host', (text, password, expected) => {
    const out = maskSecrets(text) as string;
    expect(out).not.toContain(password);
    expect(out).toBe(expected);
  });

  it('keeps a URL with no password', () => {
    const text = 'see https://example.com/a?b=c and ssh://git@host/repo';
    expect(maskSecrets(text)).toBe(text);
  });
});

describe('values that end late or oddly', () => {
  it.each([
    ['password=ab,cd-tail', 'cd-tail'],
    ['password=ab;cd-tail', 'cd-tail'],
    ['password=ab}cd-tail', 'cd-tail'],
    ['password: my pass phrase here', 'phrase'],
    ['password: |\n  first-secret-line\n  second-secret-line\nnext: ok', 'secret-line'],
    ['password: >-\n  folded-secret-line\nnext: ok', 'secret-line'],
    ["password='it''s-tail'", 's-tail'],
    ['"password":"ab"cd-tail"', 'cd-tail'],
    ['password="ab"cd-tail', 'cd-tail'],
  ])('masks every part of %j', (text, tail) => {
    const out = maskSecrets(text) as string;
    expect(out).not.toContain(tail);
    expect(out).toContain(MASKED);
  });

  it('keeps the lines after a block scalar that are not part of it', () => {
    expect(maskSecrets('password: |\n  hidden\nnext: ok')).toContain('next: ok');
  });

  it('keeps what follows a closed quote at a clean end', () => {
    expect(maskSecrets('password="x1y2z3", user=ada')).toBe(`password="${MASKED}", user=ada`);
  });
});

describe('names and values in separate members', () => {
  it.each([
    [[{ name: 'DB_PASSWORD', value: 'hunter2xx' }], 'hunter2xx'],
    [[{ name: 'Authorization', value: 'Bearer abc' }], 'Bearer abc'],
    [{ key: 'client_secret', value: 'abc123' }, 'abc123'],
    [{ header: 'X-Api-Key', value: 'k-1' }, 'k-1'],
    [
      [
        ['Authorization', 'Bearer abc'],
        ['X-Api-Key', 'k-2'],
      ],
      'k-2',
    ],
    [[['password', 'hunter2']], 'hunter2'],
    [{ request: { headers: [{ name: 'Cookie', value: 'sid=abc' }] } }, 'sid=abc'],
  ] as [JsonValue, string][])('masks the value beside a secret name in %j', (value, secret) => {
    const out = JSON.stringify(maskSecrets(value));
    expect(out).not.toContain(secret);
    expect(out).toContain(MASKED);
  });

  it('keeps a value beside a name that is no secret', () => {
    const value: JsonValue = [{ name: 'LOG_LEVEL', value: 'debug' }, ['accept', 'text/html']];
    expect(maskSecrets(value)).toEqual(value);
  });
});

describe('tags and command lines', () => {
  it.each([
    ['<password>hunter2</password>', 'hunter2', '<password>[masked]</password>'],
    [
      '<client_secret>hunter2xx</client_secret>',
      'hunter2xx',
      '<client_secret>[masked]</client_secret>',
    ],
    ['curl -u admin:hunter2 https://x', 'hunter2', 'curl -u admin:[masked] https://x'],
    ['run --password hunter2 now', 'hunter2', 'run --password [masked] now'],
    ['run --client-secret=hunter2xx now', 'hunter2xx', 'run --client-secret=[masked]'],
    ['password => hunter2', 'hunter2', 'password => [masked]'],
  ])('masks the secret in %s', (text, secret, expected) => {
    const out = maskSecrets(text) as string;
    expect(out).not.toContain(secret);
    expect(out).toBe(expected);
  });

  it('keeps a tag and a flag that name no secret', () => {
    const text = '<name>ada</name> ls -u --verbose --output file';
    expect(maskSecrets(text)).toBe(text);
  });
});

describe('what is learned and what is known', () => {
  it('keeps a known secret out of the learning limit that junk can use up', () => {
    const masker = createMasker({ emails: false });
    for (let i = 0; i < 100; i += 1)
      masker.mask({ token: `junkvalue-${String(i).padStart(4, '0')}-xxxx` });
    masker.know('opaqueMintedTokenValue0123');
    expect(masker.mask('using opaqueMintedTokenValue0123 now')).toBe(`using ${MASKED} now`);
  });

  it('hides a known secret in the forms it may be written again', () => {
    const secret = 'p@ss w\"ord/secret-1';
    const masker = createMasker({ emails: false, known: [secret] });
    for (const form of [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString('base64'),
      JSON.stringify(secret).slice(1, -1),
    ]) {
      expect(masker.mask(`see ${form} here`)).toBe(`see ${MASKED} here`);
    }
  });

  it('hides a known secret in a record the server wrote, too', () => {
    const masker = createMasker({ emails: false, known: ['server-held-secret-value'] });
    expect(masker.maskRecord({ note: 'server-held-secret-value' })).toEqual({ note: MASKED });
  });
});

describe('what is scanned', () => {
  it('masks a secret held in a member name', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXBhcnQ';
    expect(JSON.stringify(maskSecrets({ [jwt]: 1 }))).not.toContain('eyJhbGci');
  });

  it('replaces the members past the first 500 of an object or an array by a count', () => {
    const list = Array.from({ length: 1_000 }, (_unused, i) => i);
    const object = Object.fromEntries(list.map((i) => [`k${String(i)}`, i]));
    const items = maskSecrets(list) as JsonValue[];
    expect(items).toHaveLength(501);
    expect(items.at(-1)).toBe('[500 more]');
    const members = maskSecrets(object) as Record<string, JsonValue>;
    expect(Object.keys(members)).toHaveLength(501);
    expect(members['…']).toBe('500 more');
  });
});
