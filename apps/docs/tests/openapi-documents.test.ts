import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MACHINE_READABLE_REFERENCES } from '#docs/nav.ts';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

describe('the OpenAPI documents the site publishes', () => {
  const documents = MACHINE_READABLE_REFERENCES.map((reference) => reference.file).filter((file) =>
    file.startsWith('openapi/'),
  );

  it('lists the admin and the me document', () => {
    expect(documents).toEqual(['openapi/admin.json', 'openapi/me.json']);
  });

  it('has a generated file behind each, which the build serves from static', () => {
    for (const file of documents) {
      expect(existsSync(path.join(DOCS_ROOT, 'static', file)), file).toBe(true);
    }
  });
});
