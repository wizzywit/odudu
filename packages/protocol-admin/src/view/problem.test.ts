import { describe, expect, it } from 'vitest';
import { problem } from '#/view/problem';

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
