import { describe, expect, it } from 'vitest';
import { agentNotPermitted, invalidBody, invalidRequest, notFound } from '#/service/errors';

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
