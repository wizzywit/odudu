import { describe, expect, it } from 'vitest';
import {
  secretFixedNote,
  GRACE_MAX,
  rotatedNote,
  rotatedTitle,
  previousSecretLine,
  rotationFailureText,
  rotationProblem,
  rotateConsequence,
} from '#/pages/clients/services/secretRotation';

describe('secretFixedNote', () => {
  it('names a public client as having no secret', () => {
    expect(secretFixedNote({ type: 'public', token_endpoint_auth_method: 'none' })).toBe(
      'A public client has no secret to rotate.',
    );
  });

  it.each(['private_key_jwt', 'tls_client_auth'])('names a %s client as having none', (method) => {
    expect(secretFixedNote({ type: 'confidential', token_endpoint_auth_method: method })).toBe(
      `A client that authenticates with ${method} has no secret to rotate.`,
    );
  });

  it.each(['client_secret_basic', 'client_secret_post'])(
    'says nothing of a %s client',
    (method) => {
      expect(
        secretFixedNote({ type: 'confidential', token_endpoint_auth_method: method }),
      ).toBeNull();
    },
  );
});

it('holds the grace to the week the server allows', () => {
  expect(GRACE_MAX).toBe(604_800);
});

it('says the current secret stops at once, or after the grace, in the dialog that asks', () => {
  expect(rotateConsequence('billing', 0)).toContain('stops working at once');
  expect(rotateConsequence('billing', 3600)).toContain(
    'keeps working for 3600 s · 1 hour, then stops',
  );
});

it('names the client in the title and what became of the previous secret', () => {
  expect(rotatedTitle('billing')).toBe('New client secret for billing');
  expect(rotatedNote('billing', 0)).toContain('no longer works');
  expect(rotatedNote('billing', 60)).toContain('60 s · 1 minute');
});

describe('previousSecretLine', () => {
  const NOW = new Date('2026-10-06T12:00:00.000Z');

  it('says nothing once no rotation kept a secret', () => {
    expect(previousSecretLine(null, NOW)).toBeNull();
  });

  it('says the previous secret still authenticates, until when, while its grace runs', () => {
    expect(previousSecretLine('2026-10-06T13:00:00.000Z', NOW)).toEqual({
      lead: 'The previous secret authenticates until',
      at: '2026-10-06T13:00:00.000Z',
    });
  });

  it('says it stopped, once the grace has passed, and not that it authenticates', () => {
    expect(previousSecretLine('2026-10-06T11:00:00.000Z', NOW)).toEqual({
      lead: 'The previous secret stopped authenticating',
      at: '2026-10-06T11:00:00.000Z',
    });
  });
});

describe('rotationFailureText', () => {
  it("gives the server's reason, and says a lost answer is not sent again", () => {
    expect(
      rotationFailureText(
        {
          ok: false,
          kind: 'problem',
          problem: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'no' },
        },
        'Billing',
      ),
    ).toBe('The secret of Billing was not rotated: no');
    const lost = rotationFailureText({ ok: false, kind: 'network' }, 'Billing');
    expect(lost).toContain('whether the secret of Billing was rotated');
    expect(lost).toContain('It has not been sent again');
  });
});

describe('rotationProblem', () => {
  it('says nothing until a rotation failed, then what rotationFailureText says', () => {
    const lost = { ok: false, kind: 'network' } as const;
    expect(rotationProblem(null, 'Billing')).toBeNull();
    expect(rotationProblem(lost, 'Billing')).toBe(rotationFailureText(lost, 'Billing'));
  });
});
