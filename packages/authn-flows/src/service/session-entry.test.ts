import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SessionEntry } from '#/service/session-entry';

const ID = '0192f2a0-0000-7000-8000-000000000001';

function secretOf(entry: SessionEntry): string {
  return entry.cookieValue().slice(ID.length + 1);
}

describe('SessionEntry', () => {
  it('issues a fresh 32-byte base64url secret for every entry', () => {
    const first = SessionEntry.issue(ID);
    const second = SessionEntry.issue(ID);

    expect(Buffer.from(secretOf(first), 'base64url')).toHaveLength(32);
    expect(secretOf(first)).not.toBe(secretOf(second));
  });

  it('reads back what it wrote, and matches its own hash', () => {
    const issued = SessionEntry.issue(ID);
    const parsed = SessionEntry.parse(issued.cookieValue());

    expect(parsed?.id).toBe(ID);
    expect(parsed?.matches(issued.secretHash())).toBe(true);
  });

  it('matches no other secret’s hash, no missing hash and no malformed one', () => {
    const entry = SessionEntry.issue(ID);

    expect(entry.matches(SessionEntry.issue(ID).secretHash())).toBe(false);
    expect(entry.matches(null)).toBe(false);
    expect(entry.matches('not hex')).toBe(false);
    expect(entry.matches(entry.secretHash().slice(2))).toBe(false);
  });

  it('refuses a bare id, a short secret and a non-uuid id', () => {
    const secret = secretOf(SessionEntry.issue(ID));

    expect(SessionEntry.parse(ID)).toBeNull();
    expect(SessionEntry.parse(`${ID}:${secret.slice(1)}`)).toBeNull();
    expect(SessionEntry.parse(`not-a-uuid:${secret}`)).toBeNull();
    expect(SessionEntry.parse(`${ID}:${secret}:${secret}`)).toBeNull();
  });

  it('shows only its id when logged or serialised', () => {
    const entry = SessionEntry.issue(ID);
    const secret = secretOf(entry);

    expect(JSON.stringify({ entry })).not.toContain(secret);
    expect(inspect({ entry }, { showHidden: true, depth: null })).not.toContain(secret);
  });

  it('proves a purpose-bound value only with its own secret', () => {
    const entry = SessionEntry.issue(ID);
    const proof = entry.proof('logout-confirm');

    expect(entry.proves('logout-confirm', proof)).toBe(true);
    expect(entry.proves('other-purpose', proof)).toBe(false);
    expect(entry.proves('logout-confirm', '')).toBe(false);
    expect(SessionEntry.issue(ID).proves('logout-confirm', proof)).toBe(false);
    expect(proof).not.toContain(secretOf(entry));
  });
});
