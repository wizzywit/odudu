import { MESSAGE_OVERRIDE_KEY_MAX_LENGTH } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { saveOutcome } from '#/pages/branding/services/overrideSaving';
import {
  EMPTY_OVERRIDE,
  OVERRIDE_KEY_LENGTH,
  overrideProblems,
} from '#/pages/branding/services/overrideForm';

describe('the form', () => {
  it('needs a key and a text, within the server’s bounds', () => {
    expect(overrideProblems(EMPTY_OVERRIDE)).toEqual({
      key: expect.stringContaining('key') as string,
      message: expect.stringContaining('text') as string,
    });
    expect(overrideProblems({ key: 'login.title', message: 'x', etag: null })).toEqual({});
    expect(OVERRIDE_KEY_LENGTH).toBe(MESSAGE_OVERRIDE_KEY_MAX_LENGTH);
    expect(
      overrideProblems({ key: 'k'.repeat(OVERRIDE_KEY_LENGTH + 1), message: 'x', etag: null }).key,
    ).toContain(String(OVERRIDE_KEY_LENGTH));
    expect(overrideProblems({ key: 'k', message: 'x'.repeat(2001), etag: null }).message).toMatch(
      /2000/u,
    );
  });

  it('empties once saved, and is as it was when refused', () => {
    const values = { key: 'login.title', message: 'Hello', etag: null };
    const saved = saveOutcome(
      { ok: true, status: 200, data: {}, etag: null, next: null },
      { locale: 'en', key: 'login.title' },
      values,
    );
    expect(saved.values).toEqual(EMPTY_OVERRIDE);
    expect(saved.toast).toContain('login.title');
    const failed = saveOutcome(
      { ok: false, kind: 'network' },
      { locale: 'en', key: 'login.title' },
      values,
    );
    expect(failed.values).toBe(values);
    expect(failed.toast).toBeNull();
  });
});
