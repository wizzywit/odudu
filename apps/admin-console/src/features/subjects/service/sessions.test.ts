import { describe, expect, it } from 'vitest';
import {
  grantClients,
  grantsRevokedText,
  consentRevokedText,
  sessionEndedText,
  sessionsEndedText,
} from '#/features/subjects/service/sessions.ts';

describe('the toasts and groupings of sessions and grants', () => {
  it('says what ended or was revoked, counted', () => {
    expect(sessionEndedText('ada')).toBe('The session of ada ended.');
    expect(sessionsEndedText('ada', 1)).toBe('1 session of ada ended.');
    expect(sessionsEndedText('ada', 3)).toBe('3 sessions of ada ended.');
    expect(consentRevokedText('ada', 'web')).toBe("ada's consent to web revoked.");
    expect(grantsRevokedText('ada', 1, 'web')).toBe('1 grant of ada through web revoked.');
    expect(grantsRevokedText('ada', 2, 'web')).toBe('2 grants of ada through web revoked.');
  });

  it('lists each client a grant was issued through once, in the order first met', () => {
    expect(
      grantClients([
        { client_id: 'c1', client_key: 'web' },
        { client_id: 'c2', client_key: 'app' },
        { client_id: 'c1', client_key: 'web' },
      ] as never),
    ).toEqual([
      { id: 'c1', key: 'web' },
      { id: 'c2', key: 'app' },
    ]);
  });
});
