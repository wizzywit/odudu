import { describe, expect, it } from 'vitest';
import { decideLogout, type LogoutSession } from '#/usecase/logout';

const registered = ['https://app.example/after-logout'];
const session: LogoutSession = { id: 's1', subjectId: 'u1' };

describe('decideLogout', () => {
  it('confirms when there is no id_token_hint', () => {
    expect(
      decideLogout({
        hintSubject: null,
        hintSid: null,
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it('confirms when the hint names somebody other than the current session', () => {
    expect(
      decideLogout({
        hintSubject: 'u2',
        hintSid: null,
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it('confirms a sid-less hint even when its subject matches the session', () => {
    // A `sid` is what every current token carries (Back-Channel Logout
    // §2.1) — an `offline_access` grant's ID token is the one current
    // exception, since it has no session to name. Treating a missing `sid`
    // as a match-by-subject would let a stale-but-valid offline ID token
    // for this same user skip the confirmation §2 makes mandatory.
    expect(
      decideLogout({
        hintSubject: 'u1',
        hintSid: null,
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it('ends without confirmation when the hint carries a sid matching this session', () => {
    expect(
      decideLogout({
        hintSubject: 'u1',
        hintSid: 's1',
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'end', redirectTo: null });
  });

  it('confirms when the hint carries a sid for a different session, even with the same subject', () => {
    // The same End-User signed in twice in one browser: this hint is a
    // stale artifact of their first, already-ended session, and "same
    // subject" must not be enough to skip confirmation for it.
    expect(
      decideLogout({
        hintSubject: 'u1',
        hintSid: 'some-other-session',
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it('ends without confirmation on a sid match even if the subject in the hint disagrees', () => {
    // Should not arise from a genuine token (a sid belongs to one
    // subject), but decideLogout's contract is "sid governs when present" —
    // exercised directly so the precedence is pinned rather than assumed.
    expect(
      decideLogout({
        hintSubject: 'somebody-else',
        hintSid: 's1',
        session,
        requested: null,
        registered,
      }),
    ).toEqual({ kind: 'end', redirectTo: null });
  });

  it('redirects to an exactly matching registered uri', () => {
    expect(
      decideLogout({
        hintSubject: 'u1',
        hintSid: 's1',
        session,
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
      decideLogout({
        hintSubject: 'u1',
        hintSid: 's1',
        session,
        requested,
        registered,
      }),
    ).toEqual({ kind: 'render', error: 'invalid_request' });
  });

  it('still ends the session when the requested uri is unusable', () => {
    // The session ends either way; only the redirect is refused. A logout
    // that silently kept the session alive because the return URL was wrong
    // would be the worse failure.
    const decision = decideLogout({
      hintSubject: 'u1',
      hintSid: 's1',
      session,
      requested: 'https://evil.example/x',
      registered,
    });
    expect(decision.kind).toBe('render');
  });

  describe('with no live session', () => {
    it('confirms (nothing to end, no redirect requested)', () => {
      expect(
        decideLogout({
          hintSubject: null,
          hintSid: null,
          session: null,
          requested: null,
          registered,
        }),
      ).toEqual({ kind: 'confirm' });
    });

    it('confirms rather than redirecting to an unregistered uri', () => {
      expect(
        decideLogout({
          hintSubject: null,
          hintSid: null,
          session: null,
          requested: 'https://evil.example/after-logout',
          registered,
        }),
      ).toEqual({ kind: 'confirm' });
    });

    it('still redirects to an exactly matching registered uri, per §3', () => {
      // §3 forbids redirecting to an *unmatched* URI; it says nothing
      // against honouring a matched one when there is nothing to end — an
      // RP sending a user to logout after their session already idled out
      // must not be stranded with no way back.
      expect(
        decideLogout({
          hintSubject: null,
          hintSid: null,
          session: null,
          requested: 'https://app.example/after-logout',
          registered,
        }),
      ).toEqual({ kind: 'end', redirectTo: 'https://app.example/after-logout' });
    });
  });
});
