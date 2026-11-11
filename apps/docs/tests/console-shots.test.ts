import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  SECRET_REQUEST,
  newPinnedContext,
  pinPlatform,
} from '#docs/scripts/console-shots/capture.ts';
import { findSecrets } from '#docs/scripts/console-shots/guard.ts';
import { SCREENS } from '#docs/scripts/console-shots/screens.ts';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const OUT = path.join(DOCS_ROOT, 'static/console');
const RECORD = path.join(DOCS_ROOT, 'scripts/console-shots/record');
const PAGES = [
  'quick-start/index.mdx',
  ...readdirSync(path.join(DOCS_ROOT, 'content/en/admin-console'))
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => `admin-console/${name}`),
];
const manifest = JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as Record<
  string,
  { width: number; height: number }
>;

interface Used {
  name: string;
  alt: string;
  caption: string;
}

function used(): Used[] {
  return PAGES.flatMap((page) => {
    const text = readFileSync(path.join(DOCS_ROOT, 'content/en', page), 'utf8');
    return [...text.matchAll(/<ConsoleShot\s+([\s\S]*?)\/>/gu)].map((match) => {
      const prop = (key: string): string =>
        new RegExp(`${key}="([^"]*)"`, 'u').exec(match[1] ?? '')?.[1] ?? '';
      return { name: prop('name'), alt: prop('alt'), caption: prop('caption') };
    });
  });
}

// A lossy or lossless WebP's canvas size, from its header.
function webpSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  const bits = bytes.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

// 8080 is the demo client's own callback address, listed on its Advanced tab.
const STRAY_PORT = /localhost:(?!3000\b|8080\/callback(?!\w))\d+/u;

describe('the console captures', () => {
  it('has a light and a dark WebP of the size the manifest gives, for every screen', () => {
    expect(Object.keys(manifest).sort()).toEqual(SCREENS.map((screen) => screen.name).sort());
    for (const screen of SCREENS) {
      for (const theme of ['light', 'dark']) {
        const file = path.join(OUT, `${screen.name}-${theme}.webp`);
        expect(existsSync(file), file).toBe(true);
        expect(webpSize(file), file).toEqual(manifest[screen.name]);
      }
    }
  });

  it('gives every screen alt text, a caption and something to check before it is shot', () => {
    for (const screen of SCREENS) {
      expect(screen.alt.length, screen.name).toBeGreaterThan(20);
      expect(screen.caption.length, screen.name).toBeGreaterThan(10);
      expect(screen.expect.length, screen.name).toBeGreaterThan(0);
    }
  });

  it('shows on the pages only captures that exist, with the alt text and caption the screen gives', () => {
    const shown = used();
    expect(shown.length).toBeGreaterThan(5);
    for (const { name, alt, caption } of shown) {
      const screen = SCREENS.find((candidate) => candidate.name === name);
      expect(screen, name).toBeDefined();
      expect(alt, name).toBe(screen?.alt);
      expect(caption, name).toBe(screen?.caption);
    }
  });

  it('leaves no capture unused', () => {
    const names = new Set(used().map((entry) => entry.name));
    expect(SCREENS.map((screen) => screen.name).filter((name) => !names.has(name))).toEqual([]);
  });

  it('intercepts exactly the requests that make the console show a secret', () => {
    const at = (tail: string): string => `/console/api/admin/tenants/demo/${tail}`;
    expect(SECRET_REQUEST.test(at('subjects/0199aa00-0000/password'))).toBe(true);
    expect(SECRET_REQUEST.test(at('clients/0199aa00-0000/secret'))).toBe(true);
    expect(SECRET_REQUEST.test(at('subjects/0199aa00-0000/password-reset'))).toBe(false);
    expect(SECRET_REQUEST.test(at('subjects'))).toBe(false);
  });

  it('lets a record name the stack port and the demo callback and no other local port', () => {
    expect(STRAY_PORT.test('http://localhost:3000/tenants/demo')).toBe(false);
    expect(STRAY_PORT.test('http://localhost:8080/callback')).toBe(false);
    expect(STRAY_PORT.test('http://localhost:8080/callbackX')).toBe(true);
    expect(STRAY_PORT.test('http://localhost:3086/tenants/demo')).toBe(true);
  });

  it('keeps beside each image the text its page held, free of secrets', () => {
    for (const screen of SCREENS) {
      for (const theme of ['light', 'dark']) {
        const file = path.join(RECORD, `${screen.name}-${theme}.txt`);
        expect(existsSync(file), file).toBe(true);
        const text = readFileSync(file, 'utf8');
        expect(text.length, file).toBeGreaterThan(100);
        const seen = { text, attributes: [], fieldValues: [], passwordFieldsFilled: 0 };
        expect(findSecrets(seen, []), file).toEqual([]);
        expect(STRAY_PORT.test(text), file).toBe(false);
        // The administrator is the published default, or whoever the capture is given.
        const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/gu) ?? [];
        expect(
          emails.filter((email) => email !== 'admin@odudu.local'),
          file,
        ).toEqual([]);
        const given = process.env.ODUDU_ADMIN_EMAIL;
        if (given !== undefined && given !== 'admin@odudu.local') {
          expect(text.includes(given), file).toBe(false);
        }
      }
    }
  });

  it('shows in each capture the rows and the issuer its alt text names', () => {
    const record = (name: string): string =>
      readFileSync(path.join(RECORD, `${name}-light.txt`), 'utf8');
    expect(record('clients')).toContain('odudu-admin');
    expect(record('clients')).toContain('my-app');
    expect(record('subjects')).toContain('ada');
    expect(record('new-tenant')).toContain('http://localhost:3000/tenants/demo');
  });

  it('creates each context pinned to one timezone, locale and platform, whatever machine runs it', async () => {
    const made: { options: unknown; scripts: unknown[] }[] = [];
    const factory = {
      newContext: (options: unknown) => {
        const entry = { options, scripts: [] as unknown[] };
        made.push(entry);
        return Promise.resolve({ addInitScript: (script: unknown) => entry.scripts.push(script) });
      },
    };
    const viewport = { width: 800, height: 600 };
    await newPinnedContext(factory, viewport, 'dark');
    expect(made).toHaveLength(1);
    expect(made[0]?.options).toEqual({
      viewport,
      colorScheme: 'dark',
      timezoneId: 'UTC',
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    expect(made[0]?.scripts).toEqual([pinPlatform]);
  });

  it('makes the page believe it runs on a Mac, through every way it can ask', async () => {
    const page = { navigator: {} as Record<string, unknown> };
    runInNewContext(`(${pinPlatform.toString()})()`, { navigator: page.navigator });
    expect(page.navigator.platform).toBe('MacIntel');
    const data = page.navigator.userAgentData as {
      platform: string;
      getHighEntropyValues(hints: string[]): Promise<{ platform: string }>;
    };
    expect(data.platform).toBe('macOS');
    expect(await data.getHighEntropyValues(['platform'])).toEqual({ platform: 'macOS' });
    expect(readFileSync(path.join(RECORD, 'subjects-light.txt'), 'utf8')).toContain('Return');
  });
});
