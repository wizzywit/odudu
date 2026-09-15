import { describe, expect, it } from 'vitest';
import { isSessionLive } from '#/service/session-liveness';

const at = (iso: string) => new Date(iso);
const session = (createdAt: string, lastActiveAt: string, expiresAt: string) => ({
  id: 's',
  realmId: 'r',
  subjectId: 'u',
  createdAt: at(createdAt),
  lastActiveAt: at(lastActiveAt),
  expiresAt: at(expiresAt),
});

describe('isSessionLive', () => {
  const idle = 1800;

  it('is live inside both windows', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T11:50:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T12:00:00Z'))).toBe(true);
  });

  it('is dead once idle is exceeded, even well inside the ceiling', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T10:05:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
  });

  it('is dead past the ceiling, however recently it was used', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T19:59:59Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T20:00:01Z'))).toBe(false);
  });

  it('treats the exact boundary as dead on both clocks', () => {
    const ceiling = session('2026-09-15T10:00:00Z', '2026-09-15T12:00:00Z', '2026-09-15T12:00:00Z');
    expect(isSessionLive(ceiling, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
    const idled = session('2026-09-15T10:00:00Z', '2026-09-15T11:30:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(idled, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
  });
});
