import { describe, expect, it } from 'vitest';
import { writeRefusal } from '#/shared/service/capabilities/refusal.ts';

describe('writeRefusal', () => {
  const refused = (status: number, detail?: string, type = 'about:blank') => ({
    type,
    status,
    title: 'Refused',
    ...(detail === undefined ? {} : { detail }),
  });

  it('says what a ceiling refusal would have handed out and taken away', () => {
    expect(
      writeRefusal(
        refused(
          403,
          'the caller does not hold: manage-users; this removes capabilities the caller does not hold: view-audit',
        ),
      ),
    ).toBe(
      'Refused: it would hand out manage-users and take view-audit from whoever holds it through here, none of which you hold yourself.',
    );
    expect(writeRefusal(refused(403, 'the caller does not hold: manage-keys'))).toBe(
      'Refused: it would hand out manage-keys, which you do not hold yourself.',
    );
  });

  it("keeps the server's own reason for any other refusal, and names the guard", () => {
    expect(
      writeRefusal(
        refused(
          403,
          'a group every new subject joins may reach no admin capability, and this one would reach: view-users',
        ),
      ),
    ).toBe(
      'Refused: a group every new subject joins may reach no admin capability, and this one would reach: view-users.',
    );
    expect(writeRefusal(refused(403))).toBe(
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    );
    expect(writeRefusal(refused(409, 'ada is the last', 'about:blank#last-administrator'))).toBe(
      'Refused: it would leave this tenant with no enabled administrator (ada is the last). Make somebody else an administrator first.',
    );
    expect(writeRefusal(refused(409, 'would create a group reparent cycle'))).toBeNull();
    expect(writeRefusal(refused(400, 'x'))).toBeNull();
  });
});
