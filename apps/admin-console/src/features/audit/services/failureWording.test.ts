import { describe, expect, it } from 'vitest';
import { exportFailureText } from '#/features/audit/services/auditExport';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('exportFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'D400'],
    ['403', refusal(403), 'T403'],
    ['404', refusal(404), 'T404'],
    ['409', refusal(409, { detail: 'D409' }), 'D409'],
    ['412', refusal(412), 'T412'],
    [
      '413',
      refusal(413),
      'These filters match more than 10,000 events, the most an export holds. Narrow the filters and export again.',
    ],
    ['502', refusal(502, { detail: 'D502' }), 'D502'],
    ['network', failure('network'), 'The export could not be read. Nothing was saved; try again.'],
    ['schema', failure('schema'), 'The export could not be read. Nothing was saved; try again.'],
    ['defect', failure('defect'), 'The export could not be read. Nothing was saved; try again.'],
    ['403 detail', refusal(403, { detail: 'D403' }), 'D403'],
    ['400 title', refusal(400), 'T400'],
    ['500 title', refusal(500), 'T500'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'These filters could not be exported in time. Choose a time range, then export again.',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(exportFailureText(failure, false)).toBe(text);
  });
});
