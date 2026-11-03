import { describe, expect, it } from 'vitest';
import { END_SESSIONS_NEEDS_MANAGE_SESSIONS } from '@odudu/contracts/admin';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';
import { credentialFailureText } from '#/features/subjects/services/credentialOutcome';
import { changeFailureText } from '#/shared/services/capabilities';

describe('changeFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'Refused: D400'],
    [
      '403',
      refusal(403),
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    ],
    ['404', refusal(404), 'It is already gone.'],
    ['409', refusal(409, { detail: 'D409' }), 'Refused: D409'],
    ['412', refusal(412), 'Refused: T412'],
    ['413', refusal(413), 'Refused: T413'],
    ['502', refusal(502, { detail: 'D502' }), 'Refused: D502'],
    [
      'network',
      failure('network'),
      'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.',
    ],
    [
      'schema',
      failure('schema'),
      'It may have happened, but the answer could not be read. The tab shows what the server holds now.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not finish. This is a fault in the console, not something you did.',
    ],
    [
      '403 detail',
      refusal(403, { detail: 'D403' }),
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    ],
    ['400 title', refusal(400), 'Refused: T400'],
    ['500 title', refusal(500), 'Refused: T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'Refused: T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(changeFailureText(failure, 'manage-users')).toBe(text);
  });
});

describe('credentialFailureText', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'Refused: D400'],
    [
      '403',
      refusal(403),
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    ],
    ['404', refusal(404), 'Refused: T404'],
    ['409', refusal(409, { detail: 'D409' }), 'Refused: D409'],
    ['412', refusal(412), 'Refused: T412'],
    ['413', refusal(413), 'Refused: T413'],
    ['502', refusal(502, { detail: 'D502' }), 'Refused: D502'],
    [
      'network',
      failure('network'),
      'Could not confirm the result. Removal has not been sent again; the tab shows what the server holds now.',
    ],
    [
      'schema',
      failure('schema'),
      'Removal may have happened, but the answer could not be read. The tab shows what the server holds now.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not finish. This is a fault in the console, not something you did.',
    ],
    [
      '403 detail',
      refusal(403, { detail: 'D403' }),
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    ],
    ['400 title', refusal(400), 'Refused: T400'],
    ['500 title', refusal(500), 'Refused: T500'],
    ['400 too broad', refusal(400, { type: 'about:blank#audit-query-too-broad' }), 'Refused: T400'],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(credentialFailureText('Removal', failure)).toBe(text);
  });
});

describe('credentialFailureText on the refusal that is the caller’s own', () => {
  it('blames manage-sessions when ending sessions is what was refused', () => {
    expect(
      credentialFailureText(
        'Removal',
        refusal(403, { detail: END_SESSIONS_NEEDS_MANAGE_SESSIONS }),
      ),
    ).toBe(
      'Refused: it needs the manage-sessions capability, or the subject holds an admin capability you do not.',
    );
  });
});
