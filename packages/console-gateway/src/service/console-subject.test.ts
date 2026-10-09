import { describe, expect, it } from 'vitest';
import { believedSubject, principalChanged } from '#/service/console-subject';

describe('principalChanged', () => {
  it('admits a request naming the session’s own subject, whatever its method', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(principalChanged(method, 's1', 's1')).toBe(false);
    }
  });

  it('refuses a request naming another subject, a read as well as a write', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(principalChanged(method, 's2', 's1')).toBe(true);
    }
  });

  it('refuses a write naming no subject, and lets a read through', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(principalChanged(method, undefined, 's1')).toBe(true);
    }
    expect(principalChanged('GET', undefined, 's1')).toBe(false);
    expect(principalChanged('HEAD', undefined, 's1')).toBe(false);
  });
});

describe('believedSubject', () => {
  it('reads the header as sent, and takes a repeated or empty one as none', () => {
    expect(believedSubject({ 'x-odudu-console-subject': 's1' })).toBe('s1');
    expect(believedSubject({ 'x-odudu-console-subject': ['s1', 's2'] })).toBeUndefined();
    expect(believedSubject({ 'x-odudu-console-subject': '' })).toBeUndefined();
    expect(believedSubject({})).toBeUndefined();
  });
});
