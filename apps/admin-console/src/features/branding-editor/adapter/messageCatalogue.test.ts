import { describe, expect, it } from 'vitest';
import { readMessageCatalogue } from '#/features/branding-editor/adapter/messageCatalogue';
import catalogue from '#/features/branding-editor/adapter/fixtures/message-catalogue.json';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

// The transcript (get-message-overrides-put-message-overrides-and-delete-message-overrides)
// prints the catalogue only as counts and a few entries, so its fixture holds
// those entries under the kinds the page names.

describe('reading the catalogue', () => {
  it('reads the keys a template or an override may name, with their English text', async () => {
    const fake = fakeTransport({ [`GET ${ACME_ADMIN}/message-catalogue`]: json(catalogue) });
    expect(await readMessageCatalogue(fake.transport.gateway, 'acme')).toMatchObject({
      ok: true,
      data: catalogue,
    });
  });
});
