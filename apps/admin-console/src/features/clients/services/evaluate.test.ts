import { expect, it } from 'vitest';
import {
  askedAfter,
  askedParts,
  answerShown,
  artefactsOf,
  evaluateAllowed,
  evaluateFailureText,
  evaluatedScope,
  evaluationOf,
} from '#/features/clients/services/evaluate';

const RESULT = {
  scope: 'openid profile',
  id_token: { sub: 's1', name: 'Ada' },
  access_token: { sub: 's1', scope: 'openid profile' },
  userinfo: { sub: 's1' },
};

it('shows each artefact as the JSON it would carry', () => {
  const [id, access, userinfo] = artefactsOf(RESULT);
  expect(id?.label).toBe('ID token claims');
  expect(JSON.parse(id?.text ?? '')).toEqual({ sub: 's1', name: 'Ada' });
  expect(access?.label).toBe('Access token claims');
  expect(userinfo?.label).toBe('UserInfo claims');
});

it('heads each artefact by what the app gets from it', () => {
  expect(artefactsOf(RESULT).map((each) => each.heading)).toEqual([
    'What the app gets in the ID token',
    'What the app gets in the access token',
    'What UserInfo returns',
  ]);
});

it('has no ID token to show without openid', () => {
  expect(artefactsOf({ ...RESULT, id_token: null })[0]?.text).toBeNull();
});

it('names the scope it worked out, or says there was none', () => {
  expect(evaluatedScope(RESULT)).toBe('openid profile');
  expect(evaluatedScope({ ...RESULT, scope: '' })).toBe('no scope');
});

it('admits a caller who may read subjects, and rules nobody out before whoami answers', () => {
  expect(evaluateAllowed({ capabilities: ['view-users'], crossTenant: false })).toBe(true);
  expect(evaluateAllowed({ capabilities: ['manage-clients'], crossTenant: false })).toBe(false);
  expect(evaluateAllowed(undefined)).toBe(true);
});

it("gives the server's reason in the singular, so it reads as a sentence", () => {
  expect(
    evaluateFailureText({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'needs view-users' },
    }),
  ).toBe('The evaluation was not carried out: needs view-users');
});

const ANSWER = { ok: true as const, status: 200, data: RESULT, etag: null, next: null };
const BROKEN = { ok: false as const, kind: 'network' as const };

it('names a question by its subject, its scope and how often it was pressed', () => {
  expect(askedParts({ subject: 's1', scope: 'openid', press: 2 })).toEqual(['s1', 'openid', 2]);
  expect(askedParts(null)).toEqual(['', '', 0]);
});

it('counts each press of Evaluate, so the same question asked again is a new one', () => {
  expect(askedAfter(null, 's1', 'openid')).toEqual({ subject: 's1', scope: 'openid', press: 1 });
  expect(askedAfter({ subject: 's0', scope: '', press: 4 }, 's1', 'openid')).toEqual({
    subject: 's1',
    scope: 'openid',
    press: 5,
  });
});

it('is idle without a question, loading until it is answered, then ready with the answer', () => {
  const asked = { subject: 's1', scope: '', press: 1 };
  expect(evaluationOf(null, undefined)).toEqual({ status: 'idle', result: null });
  expect(evaluationOf(null, ANSWER)).toEqual({ status: 'idle', result: null });
  expect(evaluationOf(asked, undefined)).toEqual({ status: 'loading', result: null });
  expect(evaluationOf(asked, ANSWER)).toEqual({ status: 'ready', result: ANSWER });
  expect(evaluationOf(asked, BROKEN)).toEqual({ status: 'ready', result: BROKEN });
});

it('shows a success as its scope and artefacts, a failure as its text, and nothing as nothing', () => {
  expect(answerShown(null)).toEqual({ problem: null, worked: null, artefacts: [] });
  expect(answerShown(ANSWER)).toEqual({
    problem: null,
    worked: 'openid profile',
    artefacts: artefactsOf(RESULT),
  });
  expect(answerShown(BROKEN)).toEqual({
    problem: evaluateFailureText(BROKEN),
    worked: null,
    artefacts: [],
  });
});
