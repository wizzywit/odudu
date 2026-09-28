import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrafts, type DraftFields } from '#/shared/repository/useDrafts.ts';

const KEY = 'odudu.console.drafts';
const drafts = () => useDrafts.getState();

function source(record: string, section: string, fields: DraftFields, dirty = true) {
  return { record, section, dirty: () => dirty, fields: () => fields };
}

const registered: (() => void)[] = [];
function register(...args: Parameters<typeof source>): () => void {
  const unregister = drafts().register(source(...args));
  registered.push(unregister);
  return unregister;
}

beforeEach(() => {
  sessionStorage.clear();
  drafts().forgetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const unregister of registered.splice(0)) unregister();
});

describe('keeping drafts', () => {
  it('keeps the edits of every dirty section for this tab alone', () => {
    register('acme/clients/c1', 'general', {
      name: { value: 'Billing' },
      redirect_uris: { value: ['https://app.example/cb'] },
    });
    register('acme/clients/c1', 'tokens', { ttl: { value: 600 } }, false);

    expect(drafts().keepDirty('acme/s1')).toBe(1);

    expect(localStorage.length).toBe(0);
    expect(drafts().restore('acme/clients/c1', 'general')).toEqual({
      name: 'Billing',
      redirect_uris: ['https://app.example/cb'],
    });
    expect(drafts().restore('acme/clients/c1', 'tokens')).toBeNull();
  });

  it('never writes a field flagged secret', () => {
    register('acme/clients/c1', 'credentials', {
      description: { value: 'rotated for the audit' },
      client_secret: { value: 'correct-horse-battery-staple', secret: true },
    });

    drafts().keepDirty('acme/s1');

    expect(sessionStorage.getItem(KEY)).not.toContain('correct-horse-battery-staple');
    expect(sessionStorage.getItem(KEY)).not.toContain('client_secret');
    expect(drafts().restore('acme/clients/c1', 'credentials')).toEqual({
      description: 'rotated for the audit',
    });
  });

  it('keeps nothing for a section whose every edited field is secret', () => {
    register('acme/smtp', 'credentials', { password: { value: 'hunter2', secret: true } });

    expect(drafts().keepDirty('acme/s1')).toBe(0);
    expect(drafts().restore('acme/smtp', 'credentials')).toBeNull();
  });

  it('stops asking a section once it has gone', () => {
    const unregister = register('acme/roles/r1', 'general', { name: { value: 'x' } });
    unregister();
    expect(drafts().keepDirty('acme/s1')).toBe(0);
  });
});

describe('restoring drafts', () => {
  it('hands a draft back once, and forgets it when told', () => {
    register('acme/roles/r1', 'general', { description: { value: 'Support' } });
    drafts().keepDirty('acme/s1');

    expect(drafts().restore('acme/roles/r1', 'general')).toEqual({ description: 'Support' });
    drafts().forget('acme/roles/r1', 'general');
    expect(drafts().restore('acme/roles/r1', 'general')).toBeNull();
  });

  it('drops the drafts of somebody else who signed in to this tab', () => {
    register('acme/roles/r1', 'general', { description: { value: 'Support' } });
    drafts().keepDirty('acme/s1');

    drafts().adopt('acme/s2');

    expect(drafts().restore('acme/roles/r1', 'general')).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps them for the same administrator signing back in', () => {
    register('acme/roles/r1', 'general', { description: { value: 'Support' } });
    drafts().keepDirty('acme/s1');

    drafts().adopt('acme/s1');

    expect(drafts().restore('acme/roles/r1', 'general')).toEqual({ description: 'Support' });
  });

  it('treats a stored value it cannot read as no drafts at all', () => {
    sessionStorage.setItem(KEY, '{"owner":1}');
    expect(drafts().restore('acme/roles/r1', 'general')).toBeNull();
    sessionStorage.setItem(KEY, 'not json');
    expect(drafts().restore('acme/roles/r1', 'general')).toBeNull();
  });

  it('survives storage that refuses every access', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    register('acme/roles/r1', 'general', { description: { value: 'Support' } });
    expect(() => drafts().keepDirty('acme/s1')).not.toThrow();
    expect(drafts().restore('acme/roles/r1', 'general')).toBeNull();
    expect(() => {
      drafts().adopt('acme/s1');
      drafts().forget('acme/roles/r1', 'general');
    }).not.toThrow();
  });
});
