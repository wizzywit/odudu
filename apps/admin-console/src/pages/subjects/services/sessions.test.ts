import { describe, expect, it } from 'vitest';
import {
  grantClients,
  grantsRevokedText,
  consentRevokedText,
  sessionEndedText,
  sessionsEndedText,
} from '#/pages/subjects/services/sessions';

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
        { clientId: 'c1', clientKey: 'web' },
        { clientId: 'c2', clientKey: 'app' },
        { clientId: 'c1', clientKey: 'web' },
      ]),
    ).toEqual([
      { id: 'c1', key: 'web' },
      { id: 'c2', key: 'app' },
    ]);
  });
});
