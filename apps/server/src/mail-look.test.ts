import { type TenantScopedDatabase } from '@odudu/db';
import { renderResetPassword } from '@odudu/email';
import { describe, expect, it, vi } from 'vitest';
import { createMailLook } from '#/mail-look';

const TX = {} as TenantScopedDatabase;
const SCOPE = { tenantId: 'tenant-1', tenantName: 'acme' };
const BRANDING = { palette: null, darkPalette: null, logo: null, darkLogo: null };

describe('createMailLook', () => {
  it('answers the theme and the wording each reader gave', async () => {
    const look = createMailLook({
      theme: () => Promise.resolve(BRANDING),
      readOverrides: () => Promise.resolve({ en: { 'reset.button': 'Go' } }),
      log: vi.fn(),
    });
    expect(await look(TX, SCOPE)).toEqual({
      branding: BRANDING,
      overrides: { en: { 'reset.button': 'Go' } },
    });
  });

  it('builds the mail in the shipped wording, and logs, when the overrides cannot be read', async () => {
    const log = vi.fn();
    const look = createMailLook({
      theme: () => Promise.resolve(BRANDING),
      readOverrides: () => Promise.reject(new TypeError('relation secret-override-text failed')),
      log,
    });
    const { branding, overrides } = await look(TX, SCOPE);
    expect(branding).toBe(BRANDING);
    expect(overrides).toEqual({});
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      what: 'wording',
      error: 'TypeError',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-override-text');
    const mail = renderResetPassword({
      to: 'ada@example.test',
      link: 'https://id.example/x',
      tenantDisplayName: 'Acme',
      now: new Date('2026-10-29T00:00:00Z'),
      branding,
      overrides,
    });
    expect(mail.subject).toBe('Reset your Acme password');
  });

  it('keeps the wording, and logs, when the theme cannot be read', async () => {
    const log = vi.fn();
    const look = createMailLook({
      theme: () => Promise.reject(new Error('down')),
      readOverrides: () => Promise.resolve({ en: { 'reset.button': 'Go' } }),
      log,
    });
    expect(await look(TX, SCOPE)).toEqual({
      branding: null,
      overrides: { en: { 'reset.button': 'Go' } },
    });
    expect(log).toHaveBeenCalledWith({ tenantId: 'tenant-1', what: 'theme', error: 'Error' });
  });

  it('does not read the wording for a caller that shows only the theme', async () => {
    const readOverrides = vi.fn();
    const look = createMailLook({
      theme: () => Promise.resolve(BRANDING),
      readOverrides,
      log: vi.fn(),
    });
    expect(await look(TX, { ...SCOPE, wording: false })).toEqual({
      branding: BRANDING,
      overrides: {},
    });
    expect(readOverrides).not.toHaveBeenCalled();
  });

  it('hands the theme resolver the client the flow began inside', async () => {
    const theme = vi.fn(() => Promise.resolve(BRANDING));
    const look = createMailLook({ theme, readOverrides: () => Promise.resolve({}), log: vi.fn() });
    await look(TX, { ...SCOPE, clientId: 'portal' });
    expect(theme).toHaveBeenCalledWith(TX, { ...SCOPE, clientId: 'portal' });
  });

  it('falls back to the tenant look, and logs, when the client look cannot be had', async () => {
    const log = vi.fn();
    const theme = vi.fn(
      (_tx: TenantScopedDatabase, scope: { clientId?: string | null | undefined }) =>
        scope.clientId ? Promise.reject(new Error('down')) : Promise.resolve(BRANDING),
    );
    const look = createMailLook({ theme, readOverrides: () => Promise.resolve({}), log });
    const { branding } = await look(TX, { ...SCOPE, clientId: 'portal' });
    expect(branding).toBe(BRANDING);
    expect(theme).toHaveBeenCalledTimes(2);
    expect(theme.mock.calls[1]?.[1]).toEqual({ ...SCOPE, clientId: null });
    expect(log).toHaveBeenCalledWith({ tenantId: 'tenant-1', what: 'theme', error: 'Error' });
  });

  it('falls to the shipped look when the tenant look cannot be had either', async () => {
    const log = vi.fn();
    const look = createMailLook({
      theme: () => Promise.reject(new Error('down')),
      readOverrides: () => Promise.resolve({}),
      log,
    });
    expect((await look(TX, { ...SCOPE, clientId: 'portal' })).branding).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
  });
});
