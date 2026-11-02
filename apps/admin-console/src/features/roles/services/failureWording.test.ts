import { describe, expect, it } from 'vitest';
import { compositeRemovalFailureText } from '#/features/roles/services/removal';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('compositeRemovalFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'viewer was not taken out: D400'],
    [
      '403',
      refusal(403),
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    ],
    ['404', refusal(404), 'viewer was not taken out: T404'],
    ['409', refusal(409, { detail: 'D409' }), 'Refused: D409.'],
    [
      '412',
      refusal(412),
      "admin's composites changed since you opened them, so viewer was not taken out. They have been read again; look before trying again.",
    ],
    ['413', refusal(413), 'viewer was not taken out: T413'],
    ['502', refusal(502, { detail: 'D502' }), 'viewer was not taken out: D502'],
    [
      'network',
      failure('network'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    [
      'defect',
      failure('defect'),
      'Could not confirm whether viewer was taken out. Look at the list before trying again.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'Refused: D403.'],
    ['400 title', refusal(400), 'viewer was not taken out: T400'],
    ['500 title', refusal(500), 'viewer was not taken out: T500'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'viewer was not taken out: T400',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(compositeRemovalFailureText('admin', 'viewer', failure)).toBe(text);
  });
});
