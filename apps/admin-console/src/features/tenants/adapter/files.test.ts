import { afterEach, expect, it, vi } from 'vitest';
import { readFileText, saveFile } from '#/features/tenants/adapter/files.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('saves text as a file under the name given, and lets the object URL go after', async () => {
  vi.useFakeTimers();
  const made: Blob[] = [];
  const create = vi.fn((blob: Blob) => {
    made.push(blob);
    return 'blob:http://localhost/1';
  });
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });

  saveFile('acme-2026-09-29.odudu-tenant.json', '{"ü":"𝄞"}', 'application/vnd.odudu.tenant+json');

  expect(clicked).toHaveLength(1);
  expect(clicked[0]?.download).toBe('acme-2026-09-29.odudu-tenant.json');
  expect(clicked[0]?.href).toBe('blob:http://localhost/1');
  expect(clicked[0]?.isConnected).toBe(false);
  expect(made[0]?.type).toBe('application/vnd.odudu.tenant+json');
  expect(await made[0]?.text()).toBe('{"ü":"𝄞"}');
  expect(revoke).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith('blob:http://localhost/1');
});

it('reads a chosen file as text', async () => {
  const file = new File(['{"version":1}'], 'acme.json', { type: 'application/json' });
  expect(await readFileText(file)).toBe('{"version":1}');
});
