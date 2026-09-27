import { describe, expect, it } from 'vitest';
import { problem, refusalDetail } from '#/view/problem';

describe('problem', () => {
  it('carries type, title, status and the request id as instance', () => {
    expect(problem(403, 'about:blank#forbidden', 'Forbidden', 'manage-users required')).toEqual({
      type: 'about:blank#forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'manage-users required',
    });
  });

  it('omits detail rather than emitting null', () => {
    expect(problem(401, 'about:blank#unauthorized', 'Unauthorized')).not.toHaveProperty('detail');
  });
});

describe('refusalDetail', () => {
  it('names the property a closed schema refused', () => {
    const error = Object.assign(new Error('querystring must NOT have additional properties'), {
      validation: [
        {
          keyword: 'additionalProperties',
          instancePath: '',
          schemaPath: '#/additionalProperties',
          params: { additionalProperty: 'search' },
          message: 'must NOT have additional properties',
        },
      ],
    });
    expect(refusalDetail(error)).toBe('querystring must NOT have additional properties: search');
  });

  it('leaves any other message as it is', () => {
    expect(refusalDetail(new Error('body/name must be string'))).toBe('body/name must be string');
  });
});
