import { describe, expect, it } from 'vitest';
import { parseResource } from '#/service/resource-indicator';

const registered = ['https://api.example', 'https://reports.example'];

describe('parseResource', () => {
  it('accepts a single registered value', () => {
    expect(parseResource('https://api.example', registered)).toEqual({
      kind: 'ok',
      audience: ['https://api.example'],
    });
  });

  it('falls back to every registered audience when none is asked for', () => {
    expect(parseResource(undefined, registered)).toEqual({ kind: 'ok', audience: registered });
  });

  it('refuses two values rather than taking the first', () => {
    expect(parseResource(['https://api.example', 'https://reports.example'], registered)).toEqual({
      kind: 'invalid_target',
    });
  });

  it('refuses a value the client did not register', () => {
    expect(parseResource('https://elsewhere.example', registered)).toEqual({
      kind: 'invalid_target',
    });
  });

  it('refuses a value carrying a fragment, which RFC 8707 §2 forbids', () => {
    expect(parseResource('https://api.example#x', registered)).toEqual({ kind: 'invalid_target' });
  });

  it('refuses a relative reference', () => {
    expect(parseResource('/api', registered)).toEqual({ kind: 'invalid_target' });
  });

  it('refuses everything for a client that registered no audience', () => {
    expect(parseResource('https://api.example', [])).toEqual({ kind: 'invalid_target' });
  });

  it('asks for nothing when the client registered nothing', () => {
    expect(parseResource(undefined, [])).toEqual({ kind: 'ok', audience: [] });
  });
});
