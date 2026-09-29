import { describe, expect, it } from 'vitest';
import { readProblem } from '#/shared/transport/problem.ts';

const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

describe('readProblem', () => {
  it('reads the stale If-Match refusal the admin API forwards', () => {
    const body =
      '{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e77b"}';

    expect(readProblem(412, PROBLEM_JSON, body)).toEqual({
      type: 'about:blank',
      title: 'Precondition Failed',
      status: 412,
      detail: 'If-Match no longer matches',
      instance: '01a0e77b',
    });
  });

  it('reads the gateway 502, which has no detail', () => {
    const body = '{"status":502,"type":"about:blank","title":"Bad Gateway","instance":"01a0e749"}';

    expect(readProblem(502, PROBLEM_JSON, body)).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      instance: '01a0e749',
    });
  });

  it('keeps the per-path errors an import refusal carries', () => {
    const body = JSON.stringify({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: 'i',
      errors: [{ path: '/clients/0/client_id', message: 'is taken' }],
    });

    expect(readProblem(400, PROBLEM_JSON, body).errors).toEqual([
      { path: '/clients/0/client_id', message: 'is taken' },
    ]);
  });

  it('stands a problem up from the status when the body is not problem+json', () => {
    expect(readProblem(503, 'text/html', '<html>down</html>')).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
    });
  });

  it('stands a problem up from the status when the problem+json body is malformed', () => {
    expect(readProblem(500, PROBLEM_JSON, '{"status":')).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  });

  it('trusts the response status over a status the body claims', () => {
    const body = '{"status":200,"type":"about:blank","title":"Forbidden","instance":"i"}';

    expect(readProblem(403, PROBLEM_JSON, body).status).toBe(403);
  });
});
