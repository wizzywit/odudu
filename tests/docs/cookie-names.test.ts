import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deviceCookieName } from '../../packages/authn-flows/src/service/device-id.js';
import { sessionCookieName } from '../../packages/authn-flows/src/service/session-cookie.js';
import { signInHandleName } from '../../packages/authn-flows/src/service/sign-in-handle.js';
import {
  loginCookieName,
  restartCookieName,
  sessionCookieName as consoleSessionCookieName,
} from '../../packages/console-gateway/src/service/cookies.js';
import { REPO_ROOT } from './markdown.js';

// The "Cookie names" table of the configuration page, read against the
// functions that name the cookies, under TLS and without.

const PAGE = path.join(REPO_ROOT, 'apps/docs/content/en/operating/configuration.md');

function rows(): Map<string, { tls: string; plain: string }> {
  const text = readFileSync(PAGE, 'utf8');
  const section = text.slice(text.indexOf('## Cookie names'), text.indexOf('## Related settings'));
  const found = new Map<string, { tls: string; plain: string }>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5 || cells[1] === 'Cookie' || /^-+$/u.test(cells[1] ?? '')) continue;
    found.set(cells[1] ?? '', { tls: cells[2] ?? '', plain: cells[3] ?? '' });
  }
  return found;
}

const code = (value: string): string[] =>
  [...value.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? '');

describe('the cookie names the configuration page lists', () => {
  const table = rows();

  it('has every cookie the server names', () => {
    expect([...table.keys()]).toEqual([
      'Sign-in session',
      'Remembered sign-in',
      'Browser device',
      'Sign-in in progress',
      'Console session',
      'Console sign-in in progress',
      'Theme choice',
    ]);
  });

  it.each([
    ['Sign-in session', (tls: boolean) => sessionCookieName('<tenant>', tls)],
    ['Remembered sign-in', (tls: boolean) => `${sessionCookieName('<tenant>', tls)}-persistent`],
    ['Browser device', (tls: boolean) => deviceCookieName('<tenant>', tls)],
    ['Sign-in in progress', (tls: boolean) => signInHandleName(tls)],
    ['Console session', (tls: boolean) => consoleSessionCookieName(tls)],
  ])('%s is named as the code names it', (label, name) => {
    expect(code(table.get(label)?.tls ?? '')[0]).toBe(name(true));
    expect(code(table.get(label)?.plain ?? '')[0]).toBe(name(false));
  });

  it('names the console sign-in cookies as the code does', () => {
    const row = table.get('Console sign-in in progress');
    expect(code(row?.tls ?? '')[0]).toBe(loginCookieName(true));
    expect(code(row?.tls ?? '')[0]?.replace(/-login$/u, '-restart')).toBe(restartCookieName(true));
    expect(code(row?.plain ?? '')[0]).toBe(loginCookieName(false));
    expect(restartCookieName(false)).toBe(
      `${loginCookieName(false).replace(/-login$/u, '')}-restart`,
    );
  });
});
