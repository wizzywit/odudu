import { describe, expect, it } from 'vitest';
import { grantFailureText } from '#/pages/system-admins/services/grant';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('grantFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'ada was not given it: D400.'],
    ['403', refusal(403), 'ada was not given it: it needs the view-users capability.'],
    ['404', refusal(404), 'ada was not given it: T404.'],
    ['409', refusal(409, { detail: 'D409' }), 'ada was not given it: D409.'],
    ['412', refusal(412), 'ada was not given it: their roles changed while this ran. Try again.'],
    ['413', refusal(413), 'ada was not given it: T413.'],
    ['502', refusal(502, { detail: 'D502' }), 'ada was not given it: D502.'],
    [
      'network',
      failure('network'),
      'Could not confirm whether ada was given it. Check the list before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'ada may have been given it, but the answer could not be read. Check the list.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not finish, so ada was not given it. This is a fault in the console, not something you did.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'ada was not given it: D403.'],
    ['400 title', refusal(400), 'ada was not given it: T400.'],
    ['500 title', refusal(500), 'ada was not given it: T500.'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'ada was not given it: T400.',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(grantFailureText('ada', { failure, request: 'roles' })).toBe(text);
  });
});
