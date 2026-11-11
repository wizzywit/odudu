import { describe, expect, it } from 'vitest';
import {
  agentNotPermitted,
  conflict,
  emailChangeUnsupported,
  invalidBody,
  invalidRequest,
  notFound,
  REMOVAL_REFUSAL_MESSAGES,
  removalRefused,
  usernameNotEditable,
} from '#/service/errors';

describe('the refusals of the "me" API', () => {
  it('give an agent the stable code and a message of its own', () => {
    const refusal = agentNotPermitted();
    expect(refusal.error).toBe('agent_not_permitted');
    expect(refusal.error_description).toMatch(/agent/u);
    expect(refusal.error_description).not.toBe(invalidRequest('x').error_description);
  });

  it('keep the OAuth error shape', () => {
    expect(notFound('gone')).toEqual({ error: 'not_found', error_description: 'gone' });
  });
});

describe('the refusals of a username or email change', () => {
  it('give an email change its stable code', () => {
    expect(emailChangeUnsupported()).toMatchObject({ error: 'email_change_unsupported' });
  });

  it('refuse a rename the tenant has not turned on as an invalid request', () => {
    const refusal = usernameNotEditable();
    expect(refusal.error).toBe('invalid_request');
    expect(refusal.error_description).toContain('username_editable');
  });

  it('answer a name already held as a conflict', () => {
    expect(conflict('taken')).toEqual({ error: 'conflict', error_description: 'taken' });
  });
});

describe('invalidBody', () => {
  it('names the first problem and where it is', () => {
    expect(
      invalidBody([
        { path: ['label'], message: 'too long' },
        { path: [], message: 'x' },
      ]),
    ).toEqual({
      error: 'invalid_request',
      error_description: 'The request body is not valid: label: too long',
    });
  });

  it('says what it can of a problem with no place', () => {
    expect(
      invalidBody([{ path: [], message: 'must name at least one member' }]).error_description,
    ).toBe('The request body is not valid: must name at least one member');
  });
});

describe('the removal refusals', () => {
  it.each(['last_sign_in_method', 'last_second_factor'] as const)(
    'carries %s as its stable code with its own message in both languages',
    (code) => {
      const refusal = removalRefused(code);
      expect(refusal.error).toBe(code);
      expect(refusal.error_description).toBe(REMOVAL_REFUSAL_MESSAGES[code]);
      expect(REMOVAL_REFUSAL_MESSAGES[code]).not.toBe('');
    },
  );

  it('words the two refusals differently', () => {
    expect(REMOVAL_REFUSAL_MESSAGES.last_sign_in_method).not.toBe(
      REMOVAL_REFUSAL_MESSAGES.last_second_factor,
    );
  });
});
