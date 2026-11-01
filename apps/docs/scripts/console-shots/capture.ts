import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { findSecrets, type Visible } from './guard.ts';
import { untilSettled } from './poll.ts';
import type { Context, Expectation, Screen } from './screen.ts';

// The console words its key hints for the platform it is read on: Return on a
// Mac, Enter elsewhere. The pages show Return, so every capture claims to be a
// Mac. A Windows or Linux reader sees Enter where the pages say Return; that
// is the one thing the pin hides. Runs inside the page, so it names nothing
// from this file.
export function pinPlatform(): void {
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      platform: 'macOS',
      getHighEntropyValues: () => Promise.resolve({ platform: 'macOS' }),
    }),
  });
}

interface PinnableContext {
  addInitScript(script: () => void): unknown;
}

// What a page words by machine, fixed, so a record is the same on every one.
export async function newPinnedContext<T extends PinnableContext>(
  browser: {
    newContext(options: {
      viewport: { width: number; height: number };
      colorScheme: 'light' | 'dark';
      timezoneId: string;
      locale: string;
      reducedMotion: 'reduce';
    }): Promise<T>;
  },
  viewport: { width: number; height: number },
  colorScheme: 'light' | 'dark',
): Promise<T> {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    timezoneId: 'UTC',
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(pinPlatform);
  return context;
}

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

// What the quick start's pages say, whatever port the stack was reached on.
export const PUBLISHED_ORIGIN = 'http://localhost:3000';
export const PUBLISHED_ADMIN = 'admin@odudu.local';

export interface Options {
  readonly base: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly outDir: string;
  // A text sidecar per capture: what the page held, scanned again by a test.
  readonly recordDir: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ManifestEntry {
  readonly width: number;
  readonly height: number;
}

const QUALITY = 0.86;
// Requests that would make the console show a secret once: issuing a person a
// one-time password, and issuing or rotating a client secret.
export const SECRET_REQUEST = /\/(subjects|clients)\/[^/]+\/(password|secret)$/u;

async function rowsOf(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role=row], tr')]
      .filter((row) => row.querySelector('[role=columnheader], th') === null)
      .map((row) => (row as HTMLElement).innerText.replace(/\s+/gu, ' ').trim()),
  );
}

async function expectShown(page: Page, screen: Screen): Promise<void> {
  for (const expectation of screen.expect) {
    try {
      await check(page, expectation);
    } catch (cause) {
      const seen = cause instanceof Error ? `: ${cause.message}` : '';
      throw new Error(
        `screen ${screen.name}: the console does not show ${JSON.stringify(expectation)}${seen}`,
      );
    }
  }
}

async function check(page: Page, expectation: Expectation): Promise<void> {
  if ('rows' in expectation) {
    const wanted = expectation.rows;
    const matches = (rows: readonly string[]): boolean =>
      rows.length === wanted.length &&
      wanted.every((text) => rows.filter((row) => row.includes(text)).length === 1);
    // A list is read while it may still be loading: the answer is the rows it
    // settles on, and a failure says which rows it had.
    await untilSettled(() => rowsOf(page), matches, { timeoutMs: 15_000, intervalMs: 250 });
    return;
  }
  const locator =
    'heading' in expectation
      ? page.getByRole('heading', { name: expectation.heading, exact: true }).first()
      : 'label' in expectation
        ? page.getByLabel(expectation.label, { exact: true }).first()
        : page.getByRole(expectation.role, { name: expectation.name, exact: true }).first();
  await locator.waitFor({ timeout: 10_000 });
}

// The page as a reader of the quick start sees it: the stack's own address is
// the published one, the administrator is the default one, and every time
// reads "recently", so the same console gives the same bytes.
export async function present(page: Page, options: Options): Promise<void> {
  await page.evaluate(
    ({ origin, published, admin, publishedAdmin }) => {
      // A blinking caret is the one thing that moves in a still page.
      document.documentElement.style.caretColor = 'transparent';
      // A time reads differently on every run, and its width moves the columns; a
      // word that is true of every row the demo makes holds it still.
      for (const time of document.querySelectorAll('time')) time.textContent = 'recently';
      // An id and a moment differ on every run: each distinct one becomes the
      // next of a fixed series, in the order the page shows them.
      const ids = new Map<string, string>();
      const moments = new Map<string, string>();
      const standIn = (found: string): string => {
        const known = ids.get(found);
        if (known !== undefined) return known;
        const made = `0199aa00-0000-7000-8000-${String(ids.size + 1).padStart(12, '0')}`;
        ids.set(found, made);
        return made;
      };
      const momentOf = (found: string): string => {
        const known = moments.get(found);
        if (known !== undefined) return known;
        const made = `2026-03-02 09:${String(41 - moments.size).padStart(2, '0')}:00`;
        moments.set(found, made);
        return made;
      };
      const replace = (text: string): string =>
        text
          .replaceAll(origin, published)
          .replaceAll(admin, publishedAdmin)
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, standIn)
          .replace(/[0-9a-f]{8}…/gu, '0199aa00…')
          // An uploaded image is named by the first eight characters of its id.
          .replace(/(An image is set \()[0-9a-f]{8}\)/gu, '$10199aa00)')
          // A published key's public point is new on every stack.
          .replace(/("(?:x|y|n)"\s*:\s*")[A-Za-z0-9_-]+"/gu, '$1…"')
          .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/gu, momentOf);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        node.nodeValue = replace(node.nodeValue ?? '');
      }
      // A hidden field is never shown, and the form that holds it is submitted by
      // a recording that goes on after the shot, so it keeps its real address.
      const shown = 'input:not([type=password]):not([type=hidden]), textarea';
      for (const field of document.querySelectorAll(shown)) {
        (field as HTMLInputElement).value = replace((field as HTMLInputElement).value);
      }
    },
    {
      origin: options.base,
      published: PUBLISHED_ORIGIN,
      admin: options.adminUsername,
      publishedAdmin: PUBLISHED_ADMIN,
    },
  );
  // A preview of a page or a mail is a frame of its own, and says the address it was drawn at.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await frame.evaluate(
      ({ origin, published }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          node.nodeValue = (node.nodeValue ?? '').replaceAll(origin, published);
        }
      },
      { origin: options.base, published: PUBLISHED_ORIGIN },
    );
  }
}

async function visible(page: Page): Promise<Visible> {
  return page.evaluate(() => {
    const text: string[] = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      text.push(node.nodeValue ?? '');
    }
    return {
      text: text.join('\n'),
      // An uploaded image is drawn from a data address, which is the picture's own bytes in
      // base64 and the length of a token; the capture uploaded it and the page shows it.
      attributes: [...document.querySelectorAll('*')].flatMap((element) =>
        [...element.attributes].map((attribute) =>
          attribute.value.replace(/^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/u, 'data:image'),
        ),
      ),
      fieldValues: [...document.querySelectorAll('input:not([type=password]), textarea')].map(
        (element) => (element as HTMLInputElement).value,
      ),
      passwordFieldsFilled: [...document.querySelectorAll('input[type=password]')].filter(
        (element) => (element as HTMLInputElement).value !== '',
      ).length,
    };
  });
}

// Chromium encodes WebP from a canvas, so no image library is needed.
async function toWebp(context: BrowserContext, png: Buffer): Promise<Buffer> {
  const page = await context.newPage();
  const encoded = await page.evaluate(
    async ({ data, quality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', quality).split(',')[1] ?? '';
    },
    { data: png.toString('base64'), quality: QUALITY },
  );
  await page.close();
  return Buffer.from(encoded, 'base64');
}

export async function signIn(page: Page, options: Options): Promise<void> {
  await page.goto(`${options.base}/console/`);
  await page.getByLabel(/tenant/iu).fill('system');
  await page.getByRole('button', { name: 'Continue to sign-in' }).click();
  await page.getByLabel('Username').fill(options.adminUsername);
  await page.getByLabel('Password').fill(options.adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  try {
    await page.waitForURL(`${options.base}/console/system**`, { timeout: 15_000 });
  } catch {
    throw new Error(
      'the administrator did not reach the console: a generated password has to be changed first, ' +
        'so start the stack with ODUDU_ADMIN_PASSWORD set',
    );
  }
}

export function refused(options: Options): readonly string[] {
  return [
    options.adminPassword,
    ...(options.adminUsername === PUBLISHED_ADMIN ? [] : [options.adminUsername]),
  ];
}

export interface Captured {
  readonly name: string;
  readonly theme: Theme;
  readonly webp: Buffer;
  readonly record: string;
}

// A toast or an alert at shot time is a message the console is telling, and the
// one place a one-time value could appear; a capture shows none. A status line
// that announces a list loading goes when the list has loaded, so the page is
// read until none is left; every read is scanned for secrets, so one shown and
// gone while it waits is still refused. What is left after the wait is named.
export async function refuseSecrets(
  page: Page,
  label: string,
  known: readonly string[],
  allowed: readonly string[] = [],
): Promise<Visible> {
  let seen: Visible | undefined;
  const refuse = (found: readonly string[]): never => {
    throw new Error(`screen ${label} was not kept: ${found.join('; ')}`);
  };
  try {
    await untilSettled(
      async () => {
        const shown = await page.evaluate(() =>
          [...document.querySelectorAll('[role=alert], [role=status]')]
            .map((element) => (element as HTMLElement).innerText.replace(/\s+/gu, ' ').trim())
            .filter((text) => text !== ''),
        );
        const messages = shown.filter((text) => !allowed.includes(text));
        seen = await visible(page);
        const secrets = findSecrets(seen, known);
        if (secrets.length > 0) refuse(secrets);
        return messages;
      },
      (messages) => messages.length === 0,
      { timeoutMs: 10_000, intervalMs: 250 },
    );
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('screen ')) throw cause;
    const left = cause instanceof Error ? cause.message : '';
    return refuse([`an alert or a status message is on the page (${left})`]);
  }
  if (seen === undefined) throw new Error(`screen ${label} was not read`);
  return seen;
}

async function shoot(
  page: Page,
  screen: Screen,
  context: Context,
  options: Options,
): Promise<{ png: Buffer; record: string }> {
  const own = { width: options.width ?? 1100, height: options.height ?? 900 };
  await page.setViewportSize(screen.viewport ?? own);
  await screen.open(page, context);
  await expectShown(page, screen);
  // On the page as the console renders it, before anything is rewritten: the
  // administrator's name is allowed there, so only the password is refused.
  await refuseSecrets(page, screen.name, [options.adminPassword], screen.allowedStatus);
  await present(page, options);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(400);
  const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
  // And again after the shot, as published, so a late render is caught too.
  const seen = await refuseSecrets(page, screen.name, refused(options), screen.allowedStatus);
  return {
    png,
    record: `${seen.text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n')}\n`,
  };
}

/**
 * Photographs each screen in each theme, signed out screens first. Returns
 * what it made; `writeCaptures` puts it on disk.
 */
export async function captureScreens(
  screens: readonly Screen[],
  given: Options,
): Promise<{ captures: Captured[]; manifest: Record<string, ManifestEntry> }> {
  // A trailing slash would join to the paths below as `3000tenants`.
  const options = { ...given, base: given.base.replace(/\/+$/u, '') };
  const viewport = { width: options.width ?? 1100, height: options.height ?? 900 };
  const manifest: Record<string, ManifestEntry> = {};
  const captures: Captured[] = [];
  const context: Context = { base: options.base, tenant: 'demo' };
  const browser: Browser = await chromium.launch();
  try {
    for (const theme of THEMES) {
      const browserContext = await newPinnedContext(browser, viewport, theme);
      const sent: string[] = [];
      await browserContext.route(
        (url) => SECRET_REQUEST.test(url.pathname),
        async (route) => {
          if (route.request().method() === 'POST') {
            sent.push(route.request().url());
            await route.abort();
          } else await route.continue();
        },
      );
      const page = await browserContext.newPage();
      let signedIn = false;
      const ordered = [...screens].sort((a, b) => Number(a.signedIn) - Number(b.signedIn));
      for (const screen of ordered) {
        if (screen.signedIn && !signedIn) {
          await signIn(page, options);
          signedIn = true;
        }
        const { png, record } = await shoot(page, screen, context, options);
        captures.push({
          name: screen.name,
          theme,
          webp: await toWebp(browserContext, png),
          record,
        });
        manifest[screen.name] = screen.viewport ?? viewport;
        await screen.leave?.(page, context);
        await page.setViewportSize(viewport);
        if (sent.length > 0) {
          throw new Error(
            `screen ${screen.name} sent a request that issues a secret: ${sent.join(', ')}`,
          );
        }
      }
      await browserContext.close();
    }
  } finally {
    await browser.close();
  }
  return { captures, manifest };
}

export function writeCaptures(
  result: { captures: Captured[]; manifest: Record<string, ManifestEntry> },
  options: Pick<Options, 'outDir' | 'recordDir'>,
): void {
  mkdirSync(options.outDir, { recursive: true });
  mkdirSync(options.recordDir, { recursive: true });
  for (const { name, theme, webp, record } of result.captures) {
    writeFileSync(path.join(options.outDir, `${name}-${theme}.webp`), webp);
    writeFileSync(path.join(options.recordDir, `${name}-${theme}.txt`), record);
  }
  writeFileSync(
    path.join(options.outDir, 'manifest.json'),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
  );
}
