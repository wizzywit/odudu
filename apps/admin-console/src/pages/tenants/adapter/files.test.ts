import { expect, it } from 'vitest';
import { readFileText } from '#/pages/tenants/adapter/files';

it('reads a chosen file as text', async () => {
  const file = new File(['{"version":1}'], 'acme.json', { type: 'application/json' });
  expect(await readFileText(file)).toBe('{"version":1}');
});
