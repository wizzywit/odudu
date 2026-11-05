import { describe, expect, it } from 'vitest';
import { acceptedIssuers } from '#/service/issuer';

const NOW = new Date('2026-11-04T12:00:00Z');
const CANONICAL = 'https://login.acme.example';
const PREVIOUS = 'https://id.example/tenants/acme';
const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

describe('acceptedIssuers', () => {
  it('is the canonical issuer alone when nothing was retired', () => {
    expect(acceptedIssuers(CANONICAL, [], NOW)).toEqual([CANONICAL]);
  });

  it('adds a retired issuer whose window is still open, after the canonical one', () => {
    expect(acceptedIssuers(CANONICAL, [{ issuer: PREVIOUS, expiresAt: at(1) }], NOW)).toEqual([
      CANONICAL,
      PREVIOUS,
    ]);
  });

  it('drops a retired issuer at the instant its window ends and after', () => {
    const retired = [{ issuer: PREVIOUS, expiresAt: NOW }];
    expect(acceptedIssuers(CANONICAL, retired, NOW)).toEqual([CANONICAL]);
    expect(acceptedIssuers(CANONICAL, retired, at(60))).toEqual([CANONICAL]);
  });

  it('keeps a live one beside an expired one', () => {
    const retired = [
      { issuer: 'https://old.example', expiresAt: at(-1) },
      { issuer: PREVIOUS, expiresAt: at(30) },
    ];
    expect(acceptedIssuers(CANONICAL, retired, NOW)).toEqual([CANONICAL, PREVIOUS]);
  });

  it('names an issuer once, though it is both canonical and retired', () => {
    expect(acceptedIssuers(CANONICAL, [{ issuer: CANONICAL, expiresAt: at(30) }], NOW)).toEqual([
      CANONICAL,
    ]);
  });
});
