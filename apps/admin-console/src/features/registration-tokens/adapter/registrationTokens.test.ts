import { expect, it } from 'vitest';
import {
  mintToken,
  readTokenPage,
  revokeToken,
} from '#/features/registration-tokens/adapter/registrationTokens';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { RT } from '#/testing/tokensFixtures';

// The bodies are those of get-registration-tokens-post-registration-tokens-and-delete-registration.md,
// verbatim: the mint's 201, the list that follows it and the DELETE that answers 204.
const MINTED = {
  id: '01a0e1bd-1658-7dd7-a886-e6d701026191',
  token: 'iMpoXXUt6YF1ioil8i0eI8b912sLAHPjNLISdtXG1Eo',
  remaining_uses: 1,
  expires_at: '2026-09-27T08:21:00.760Z',
};

const LISTED = {
  items: [
    {
      id: '01a0e1bd-1658-7dd7-a886-e6d701026191',
      remaining_uses: 1,
      created_at: '2026-09-27T07:21:00.759Z',
      expires_at: '2026-09-27T08:21:00.760Z',
    },
  ],
};

it('reads a page of live tokens from the registration-tokens path, passing limit and cursor on', async () => {
  const fake = fakeTransport({ [`GET ${RT}`]: json(LISTED) });
  const query = new URLSearchParams({ limit: '1', after: 'a.b' });
  const result = await readTokenPage(fake.transport.gateway, 'acme', query);
  expect(result).toMatchObject({ ok: true, data: LISTED });
  expect(fake.sent[0]).toMatchObject({ method: 'GET', path: RT });
  expect(fake.sent[0]?.search.get('limit')).toBe('1');
  expect(fake.sent[0]?.search.get('after')).toBe('a.b');
});

it('refuses a listed token that carries nothing of what a token has', async () => {
  const fake = fakeTransport({ [`GET ${RT}`]: json({ items: [{ id: 'x' }] }) });
  expect(await readTokenPage(fake.transport.gateway, 'acme', new URLSearchParams())).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('mints with uses and ttl_seconds as the body and reads the one answer that has the token', async () => {
  const fake = fakeTransport({ [`POST ${RT}`]: json(MINTED, 201) });
  const result = await mintToken(fake.transport.gateway, 'acme', { uses: 1, ttl_seconds: 3600 });
  expect(result).toMatchObject({ ok: true, data: MINTED });
  expect(fake.sent[0]).toMatchObject({
    method: 'POST',
    path: RT,
    body: { uses: 1, ttl_seconds: 3600 },
  });
});

it('refuses a mint answer that has no token to show', async () => {
  const fake = fakeTransport({
    [`POST ${RT}`]: json({ id: MINTED.id, expires_at: MINTED.expires_at }, 201),
  });
  expect(
    await mintToken(fake.transport.gateway, 'acme', { uses: 1, ttl_seconds: 3600 }),
  ).toMatchObject({ ok: false, kind: 'schema' });
});

it('revokes one token by its id and accepts the 204 that has no body', async () => {
  const path = `DELETE ${RT}/01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e`;
  const fake = fakeTransport({ [path]: () => new Response(null, { status: 204 }) });
  const result = await revokeToken(
    fake.transport.gateway,
    'acme',
    '01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e',
  );
  expect(result.ok).toBe(true);
  expect(fake.sent[0]).toMatchObject({ method: 'DELETE' });
});

it('reads a 404 for a token that is no longer live as a problem, not as success', async () => {
  const fake = fakeTransport({ [`DELETE ${RT}/t1`]: problem(404, 'about:blank', 'Not Found') });
  expect(await revokeToken(fake.transport.gateway, 'acme', 't1')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});
