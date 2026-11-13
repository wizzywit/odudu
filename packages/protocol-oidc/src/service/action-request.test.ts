import { describe, expect, it } from 'vitest';
import {
  actionRefusal,
  actionStatusParameter,
  effectiveMaxAge,
  owedWithRequested,
  parseAction,
  requestedActionOf,
  requestedVariant,
} from '#/service/action-request';

describe('parseAction', () => {
  it('finds no action where none is sent', () => {
    expect(parseAction({})).toEqual({ kind: 'none' });
    expect(parseAction(undefined)).toEqual({ kind: 'none' });
    expect(parseAction({ scope: 'openid' })).toEqual({ kind: 'none' });
    expect(parseAction({ action: undefined })).toEqual({ kind: 'none' });
  });

  it.each([
    'verify-email',
    'update-password',
    'configure-totp',
    'configure-passkey',
    'generate-recovery-codes',
    'update-profile',
  ])('accepts %s', (action) => {
    expect(parseAction({ action })).toEqual({ kind: 'action', action });
  });

  it.each([
    ['empty', ''],
    ['unknown', 'delete-account'],
    ['the tenant’s own terms, which only the tenant asks for', 'accept-terms'],
    ['another case', 'Update-Password'],
    ['padded', ' configure-totp'],
    ['two values', ['configure-totp', 'update-password']],
    ['the same value twice', ['configure-totp', 'configure-totp']],
    ['one empty value among others', ['configure-totp', '']],
    ['not text', 7],
    ['an object', { 0: 'configure-totp' }],
  ])('refuses %s', (_label, action) => {
    expect(parseAction({ action })).toEqual({ kind: 'invalid' });
  });
});

describe('requestedActionOf', () => {
  it('is the action while it has no ending, and nothing after', () => {
    expect(requestedActionOf({ action: 'configure-totp' })).toBe('configure-totp');
    expect(requestedActionOf({ action: 'configure-totp', actionStatus: 'cancelled' })).toBeNull();
    expect(requestedActionOf({})).toBeNull();
  });
});

describe('requestedActionOf, for an action an application cannot start', () => {
  it('is nothing, whatever a parked request says', () => {
    expect(requestedActionOf({ action: 'accept-terms' })).toBeNull();
  });
});

describe('owedWithRequested', () => {
  it('adds the requested action to what is owed, once', () => {
    expect(owedWithRequested(['update-password'], { action: 'configure-totp' })).toEqual([
      'update-password',
      'configure-totp',
    ]);
    expect(owedWithRequested(['configure-totp'], { action: 'configure-totp' })).toEqual([
      'configure-totp',
    ]);
  });

  it('leaves what is owed alone when the action ended or was never asked', () => {
    expect(owedWithRequested(['update-password'], {})).toEqual(['update-password']);
    expect(owedWithRequested([], { action: 'configure-totp', actionStatus: 'success' })).toEqual(
      [],
    );
  });
});

describe('effectiveMaxAge', () => {
  it('is the tighter of the client’s max_age and the tenant window for an action', () => {
    expect(effectiveMaxAge(null, 300, true)).toBe(300);
    expect(effectiveMaxAge(60, 300, true)).toBe(60);
    expect(effectiveMaxAge(900, 300, true)).toBe(300);
    expect(effectiveMaxAge(0, 300, true)).toBe(0);
  });

  it('is the client’s own where no action is asked', () => {
    expect(effectiveMaxAge(null, 300, false)).toBeNull();
    expect(effectiveMaxAge(900, 300, false)).toBe(900);
  });
});

describe('actionStatusParameter', () => {
  it('is the status of an action that ended, and absent otherwise', () => {
    expect(actionStatusParameter({ action: 'configure-totp', actionStatus: 'success' })).toBe(
      'success',
    );
    expect(actionStatusParameter({ action: 'configure-totp' })).toBeNull();
    expect(actionStatusParameter({})).toBeNull();
  });

  it('is never a status without the action that produced it', () => {
    expect(actionStatusParameter({ actionStatus: 'success' })).toBeNull();
  });
});

describe('actionRefusal', () => {
  const FACTS = {
    action: 'configure-totp' as const,
    allowedActions: ['configure-totp' as const],
    holdsMeRead: true,
    prompts: new Set<string>(),
    passkeyAvailable: true,
  };

  it('lets an allowed action through for a client that can read the outcome', () => {
    expect(actionRefusal(FACTS)).toBeNull();
  });

  it('refuses an action the client is not allowed, or one it cannot read the outcome of', () => {
    const sentence = 'This client may not start that action';
    expect(actionRefusal({ ...FACTS, allowedActions: [] })).toBe(sentence);
    expect(actionRefusal({ ...FACTS, allowedActions: ['update-password'] })).toBe(sentence);
    expect(actionRefusal({ ...FACTS, holdsMeRead: false })).toBe(sentence);
  });

  it('refuses an action where no page may be shown', () => {
    for (const prompt of ['none', 'create']) {
      expect(actionRefusal({ ...FACTS, prompts: new Set([prompt]) })).toBe(
        'action cannot be sent with prompt=none or prompt=create',
      );
    }
    expect(actionRefusal({ ...FACTS, prompts: new Set(['login', 'consent']) })).toBeNull();
  });

  it('refuses a passkey where none can be enrolled', () => {
    const passkey = {
      ...FACTS,
      action: 'configure-passkey' as const,
      allowedActions: ['configure-passkey' as const],
    };
    expect(actionRefusal(passkey)).toBeNull();
    expect(actionRefusal({ ...passkey, passkeyAvailable: false })).not.toBeNull();
  });
});

describe('requestedVariant', () => {
  it('names the action when an application asked and the tenant does not owe it', () => {
    expect(requestedVariant('configure-totp', [])).toBe('configure-totp');
    expect(requestedVariant('configure-totp', ['update-password'])).toBe('configure-totp');
  });

  it('names nothing when the tenant owes the same action', () => {
    expect(requestedVariant('update-password', ['update-password'])).toBeNull();
  });

  it('names nothing when no action was asked for', () => {
    expect(requestedVariant(null, [])).toBeNull();
    expect(requestedVariant(null, ['configure-totp'])).toBeNull();
  });
});
