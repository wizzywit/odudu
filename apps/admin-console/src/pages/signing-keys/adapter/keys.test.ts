import { expect, it } from 'vitest';
import { deleteKey, promoteKey, retireKey, stageKey } from '#/pages/signing-keys/adapter/keys';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { KEYS } from '#/testing/keysFixtures';

// The bodies are those of get-keys-post-keys-post-keysidpromote-and-post-keysidretire.md
// and delete-keysid.md, verbatim: the staged key, the same key once promoted, a key
// once retired, and the typed refusal of retiring the active key.
const STAGED = {
  id: '01a0d6fe-e527-77e6-b71d-57ed1a903cc3',
  status: 'rotating',
  kid: '01a0d6fe-e526-7caf-9184-e66cbfab9a4b',
  alg: 'ES256',
  created_at: '2026-09-25T05:17:04.166Z',
  not_after: null,
};
const PROMOTED = { ...STAGED, status: 'active' };
const RETIRED = {
  id: '01a0d6fc-3654-7f93-817b-bd7f1bb2ff55',
  status: 'retired',
  kid: '01a0d6fc-3654-7f93-817b-bd7eb6490305',
  alg: 'ES256',
  created_at: '2026-09-25T05:14:08.294Z',
  not_after: null,
};

it('stages a key by posting the algorithm to the keys path', async () => {
  const fake = fakeTransport({ [`POST ${KEYS}`]: json(STAGED, 201) });
  const result = await stageKey(fake.transport.gateway, 'acme', 'ES256');
  expect(result).toMatchObject({ ok: true, data: STAGED });
  expect(fake.sent[0]).toMatchObject({ method: 'POST', path: KEYS, body: { alg: 'ES256' } });
});

it('refuses a staged key that carries nothing of what a key has', async () => {
  const fake = fakeTransport({ [`POST ${KEYS}`]: json({ id: 'x' }, 201) });
  expect(await stageKey(fake.transport.gateway, 'acme', 'RS256')).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('promotes a key by its id, with no body and no If-Match', async () => {
  const fake = fakeTransport({ [`POST ${KEYS}/${STAGED.id}/promote`]: json(PROMOTED) });
  const result = await promoteKey(fake.transport.gateway, 'acme', STAGED.id);
  expect(result).toMatchObject({ ok: true, data: PROMOTED });
  expect(fake.sent[0]).toMatchObject({ method: 'POST', body: undefined, ifMatch: null });
});

it('retires a key by its id', async () => {
  const fake = fakeTransport({ [`POST ${KEYS}/${RETIRED.id}/retire`]: json(RETIRED) });
  const result = await retireKey(fake.transport.gateway, 'acme', RETIRED.id);
  expect(result).toMatchObject({ ok: true, data: RETIRED });
  expect(fake.sent[0]).toMatchObject({ method: 'POST', body: undefined, ifMatch: null });
});

it('reads the typed refusal of retiring the active key as a problem with its type', async () => {
  const fake = fakeTransport({
    [`POST ${KEYS}/k1/retire`]: problem(409, 'about:blank#key-active', 'Conflict', {
      detail:
        'signing key 01a131b5-eea5-775d-9b0e-bab28d5b9921 is active; promote another key first',
    }),
  });
  expect(await retireKey(fake.transport.gateway, 'acme', 'k1')).toMatchObject({
    ok: false,
    kind: 'problem',
    problem: { status: 409, type: 'about:blank#key-active' },
  });
});

it('deletes a retired key by its id and accepts the 204 that has no body', async () => {
  const fake = fakeTransport({
    [`DELETE ${KEYS}/${RETIRED.id}`]: () => new Response(null, { status: 204 }),
  });
  expect((await deleteKey(fake.transport.gateway, 'acme', RETIRED.id)).ok).toBe(true);
  expect(fake.sent[0]).toMatchObject({ method: 'DELETE', path: `${KEYS}/${RETIRED.id}` });
});
