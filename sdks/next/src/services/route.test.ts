import { describe, expect, it } from 'vitest';
import { routeFor } from '#/services/route';

const MOUNT = '/api/auth';
const PROXY = '/api/auth/proxy';

describe('routeFor', () => {
  it.each(['login', 'callback', 'logout', 'session'])('names %s', (name) => {
    expect(routeFor(`${MOUNT}/${name}`, MOUNT, PROXY)).toBe(name);
  });

  it('names the proxy for its path and anything below it', () => {
    expect(routeFor(PROXY, MOUNT, PROXY)).toBe('proxy');
    expect(routeFor(`${PROXY}/api/orders`, MOUNT, PROXY)).toBe('proxy');
  });

  it('does not treat a longer first segment as the proxy', () => {
    expect(routeFor(`${PROXY}x/orders`, MOUNT, PROXY)).toBeUndefined();
  });

  it.each([
    '/api/auth',
    '/api/auth/',
    '/api/auth/unknown',
    '/api/auth/login/extra',
    '/api/auth/Login',
    '/api/other/login',
    '/login',
  ])('names nothing for %s', (path) => {
    expect(routeFor(path, MOUNT, PROXY)).toBeUndefined();
  });

  it('works with a mount below a base path and with the root', () => {
    expect(routeFor('/app/auth/login', '/app/auth', '/app/auth/proxy')).toBe('login');
    expect(routeFor('/login', '', '/proxy')).toBe('login');
    expect(routeFor('/proxy/x', '', '/proxy')).toBe('proxy');
  });
});
