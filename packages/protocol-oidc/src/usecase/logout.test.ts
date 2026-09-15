import { describe, expect, it } from 'vitest';
import { decideLogout } from '#/usecase/logout';

const registered = ['https://app.example/after-logout'];

describe('decideLogout', () => {
  it('confirms when there is no id_token_hint', () => {
    expect(
      decideLogout({ hintSubject: null, sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'confirm' });
  });

  it('confirms when the hint names somebody other than the current session', () => {
    expect(
      decideLogout({ hintSubject: 'u2', sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'confirm' });
  });

  it('ends without confirmation when the hint matches the session', () => {
    expect(
      decideLogout({ hintSubject: 'u1', sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'end', redirectTo: null });
  });

  it('redirects to an exactly matching registered uri', () => {
    expect(
      decideLogout({
        hintSubject: 'u1',
        sessionSubject: 'u1',
        requested: 'https://app.example/after-logout',
        registered,
      }),
    ).toEqual({ kind: 'end', redirectTo: 'https://app.example/after-logout' });
  });

  it.each([
    ['https://app.example/after-logout/'],
    ['https://app.example/after-logout?x=1'],
    ['https://APP.example/after-logout'],
    ['https://evil.example/after-logout'],
  ])('renders rather than redirecting to %s', (requested) => {
    expect(
      decideLogout({ hintSubject: 'u1', sessionSubject: 'u1', requested, registered }),
    ).toEqual({ kind: 'render', error: 'invalid_request' });
  });

  it('still ends the session when the requested uri is unusable', () => {
    // The session ends either way; only the redirect is refused. A logout
    // that silently kept the session alive because the return URL was wrong
    // would be the worse failure.
    const decision = decideLogout({
      hintSubject: 'u1',
      sessionSubject: 'u1',
      requested: 'https://evil.example/x',
      registered,
    });
    expect(decision.kind).toBe('render');
  });
});
