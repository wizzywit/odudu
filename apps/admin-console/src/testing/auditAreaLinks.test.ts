import { expect, it } from 'vitest';
import { resourceHref } from '#/features/audit/services/links';
import { areaAt } from '#/features/shell';

const ID = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';

// The audit trail names areas by path; one the shell no longer has would
// only fail when somebody clicked it.
it.each(['signing_key', 'flow', 'registration_token'])(
  'an audited %s opens an area the shell catalogue knows',
  (type) => {
    const asked: string[] = [];
    const href = resourceHref('acme', type, ID, {}, (area) => {
      asked.push(area);
      return `/console/acme/${areaAt(area).path}`;
    });
    expect(asked).toHaveLength(1);
    expect(href).toBe(`/console/acme/${asked[0] ?? ''}`);
  },
);
