import { describe, expect, it } from 'vitest';
import { testOutcome } from '#/features/email/services/test';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('testOutcome', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'Not sent. The server said: D400.'],
    [
      '403',
      refusal(403),
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    ],
    ['404', refusal(404), 'The test message was not sent: T404'],
    ['409', refusal(409, { detail: 'D409' }), 'The test message was not sent: D409'],
    ['412', refusal(412), 'The test message was not sent: T412'],
    ['413', refusal(413), 'The test message was not sent: T413'],
    ['502', refusal(502, { detail: 'D502' }), 'Not sent. The relay failed: D502.'],
    [
      'network',
      failure('network'),
      'Could not confirm whether the test message was sent. It has not been sent again; look at the inbox before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'The test message may have been sent, but the answer could not be read. Reload to check.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not finish, so the test message was not sent. This is a fault in the console, not something you did.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'Refused: D403.'],
    ['400 title', refusal(400), 'Not sent. The server said: T400.'],
    ['500 title', refusal(500), 'The test message was not sent: T500'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'Not sent. The server said: T400.',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(testOutcome(failure, 'a@b.c').text).toBe(text);
  });
});
