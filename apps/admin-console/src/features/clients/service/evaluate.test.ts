import { expect, it } from 'vitest';
import { artefactsOf, evaluatedScope } from '#/features/clients/service/evaluate.ts';

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

it('has no ID token to show without openid', () => {
  expect(artefactsOf({ ...RESULT, id_token: null })[0]?.text).toBeNull();
});

it('names the scope it worked out, or says there was none', () => {
  expect(evaluatedScope(RESULT)).toBe('openid profile');
  expect(evaluatedScope({ ...RESULT, scope: '' })).toBe('no scope');
});
