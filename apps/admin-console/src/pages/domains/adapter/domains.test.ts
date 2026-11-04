import { expect, it } from 'vitest';
import {
  activateDomain,
  deactivateDomain,
  readDomains,
  readPasskeyImpact,
  registerDomain,
  removeDomain,
  verifyDomain,
} from '#/pages/domains/adapter/domains';
import { domain, DOMAINS, IMPACT, listAnswer } from '#/testing/domainsFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

const ACME = 'acme';

it('reads the first page of domains with the tag the answer carries', async () => {
  const { transport } = fakeTransport({ [`GET ${DOMAINS}`]: listAnswer([domain('a', 'pending')]) });
  const result = await readDomains(transport.gateway, ACME);
  expect(result.ok && result.etag).toBe('"path"');
  expect(result.ok && result.data.items).toHaveLength(1);
});

it('registers a host', async () => {
  const { transport, sent } = fakeTransport({
    [`POST ${DOMAINS}`]: json(domain('a', 'pending'), 201),
  });
  await registerDomain(transport.gateway, ACME, 'a.acme.com');
  expect(sent[0]?.body).toEqual({ host: 'a.acme.com' });
});

it('verifies, activates, deactivates and removes by the domain’s id, the switches with If-Match', async () => {
  const { transport, sent } = fakeTransport({
    [`POST ${DOMAINS}/a%2Fb/verify`]: json(domain('a', 'verified')),
    [`POST ${DOMAINS}/a%2Fb/activate`]: json(domain('a', 'verified')),
    [`POST ${DOMAINS}/a%2Fb/deactivate`]: json(domain('a', 'verified')),
    [`DELETE ${DOMAINS}/a%2Fb`]: () => new Response(null, { status: 204 }),
  });
  await verifyDomain(transport.gateway, ACME, 'a/b');
  await activateDomain(transport.gateway, ACME, 'a/b', '"t"');
  await deactivateDomain(transport.gateway, ACME, 'a/b', '"u"');
  const removed = await removeDomain(transport.gateway, ACME, 'a/b');
  expect(removed.ok).toBe(true);
  expect(sent.map((request) => request.ifMatch)).toEqual([null, '"t"', '"u"', null]);
});

it('asks the passkey impact of a target address', async () => {
  const { transport, sent } = fakeTransport({
    [`GET ${IMPACT}`]: json({ subjects: 2, capped: false }),
  });
  const result = await readPasskeyImpact(transport.gateway, ACME, 'login.acme.com');
  expect(result.ok && result.data.subjects).toBe(2);
  expect(sent[0]?.search.get('canonical')).toBe('login.acme.com');
});
