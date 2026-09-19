import { describe, expect, it } from 'vitest';
import { lifespanFor } from '#/service/session-lifespan';

const realm = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36000,
  rememberMeIdleSeconds: 604800,
  rememberMeMaxSeconds: 2592000,
};

describe('lifespanFor', () => {
  it('uses the ordinary pair for a login that did not ask to be remembered', () => {
    expect(lifespanFor(realm, false)).toEqual({ idleSeconds: 1800, maxSeconds: 36000 });
  });

  it('uses the remembered pair for one that did', () => {
    expect(lifespanFor(realm, true)).toEqual({ idleSeconds: 604800, maxSeconds: 2592000 });
  });
});
