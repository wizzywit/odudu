import { type TenantScopedDatabase } from '@odudu/db';
import { addressIssuer, addressUrl } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { canonicalAddressFor } from '#/usecase/canonical-address';

const tx = {} as unknown as TenantScopedDatabase;
const acme = { id: 'tenant-1', name: 'acme' };

describe('canonicalAddressFor', () => {
  it('is the path address when the tenant has no canonical domain', async () => {
    const address = await canonicalAddressFor(tx, acme, 'https://id.example.com/', true, () =>
      Promise.resolve(null),
    );
    expect(addressIssuer(address)).toBe('https://id.example.com/tenants/acme');
  });

  it('is the domain address when the lookup names a canonical host', async () => {
    const lookup = vi.fn(() => Promise.resolve('login.acme.com'));
    const address = await canonicalAddressFor(tx, acme, 'https://id.example.com', true, lookup);
    expect(addressUrl(address, '/login-actions/reset-password')).toBe(
      'https://login.acme.com/login-actions/reset-password',
    );
    expect(lookup).toHaveBeenCalledWith(tx, 'tenant-1');
  });

  it('follows the scheme the deployment is served over', async () => {
    const address = await canonicalAddressFor(tx, acme, 'http://localhost:3000', false, () =>
      Promise.resolve('login.acme.test'),
    );
    expect(addressIssuer(address)).toBe('http://login.acme.test');
  });
});
