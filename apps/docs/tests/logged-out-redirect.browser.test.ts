import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { chromium, type Browser } from '@playwright/test';
import { pageHeaders, type PageLocale } from '@odudu/kernel';
import { renderLoggedOutRedirectPage } from '@odudu/protocol-oidc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The page that ends a logout with front-channel frames and then sends the
// browser on, as the real renderer builds it, under the policy `pageHeaders`
// derives for it, in a real browser. A tenant's template places `{{script}}`,
// `{{message}}` and `{{frames}}` where it likes; the redirect must not care.

const FRAME_DELAY_MS = 500;
// The page's own meta refresh follows at five seconds. Leaving sooner is the
// script's doing, so a script that failed to run shows as a late arrival.
const SCRIPT_LEAVES_BY_MS = 4000;
const ORDERINGS = [
  ['message', 'frames', 'script'],
  ['script', 'frames', 'message'],
  ['frames', 'script', 'message'],
  ['message', 'script', 'frames'],
  ['script', 'message', 'frames'],
] as const;

interface Hit {
  path: string;
  at: number;
}

let server: Server;
let browser: Browser;
let port = 0;
const hits: Hit[] = [];
const pages = new Map<string, { html: string; headers: ReturnType<typeof pageHeaders> }>();

const PAGE_HOST = '127.0.0.1';
// A second name for the same machine is a second origin, as a relying party's is.
const FRAME_HOST = 'localhost';

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    const served = pages.get(path);
    if (served !== undefined) {
      for (const [name, value] of served.headers) response.setHeader(name, value);
      response.end(served.html);
      return;
    }
    if (path.startsWith('/frame/')) {
      setTimeout(() => {
        hits.push({ path, at: Date.now() });
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><title>frame</title>');
      }, FRAME_DELAY_MS);
      return;
    }
    if (path === '/after') {
      hits.push({ path, at: Date.now() });
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>arrived</title>');
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, PAGE_HOST, resolve));
  port = (server.address() as AddressInfo).port;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

function themed(order: readonly string[]): PageLocale {
  return {
    tag: 'en',
    dir: 'ltr',
    branding: {
      origin: `http://${PAGE_HOST}:${String(port)}`,
      templates: { 'logged-out': order.map((part) => `{{${part}}}`).join('') },
      tokensCss: '',
      stylesheetUrl: null,
      faviconUrl: null,
      logo: null,
      assetUrls: [],
    },
  };
}

const frameUrls = (): string[] =>
  [1, 2].map((n) => `http://${FRAME_HOST}:${String(port)}/frame/${String(n)}`);

// Registers the page under a path of its own and returns that path.
function publish(name: string, order: readonly string[], injected = ''): string {
  const target = `http://${PAGE_HOST}:${String(port)}/after`;
  const rendered = renderLoggedOutRedirectPage(frameUrls(), target, themed(order));
  const html = rendered.html.replace('</body>', `${injected}</body>`);
  pages.set(`/${name}`, {
    html,
    headers: [...pageHeaders(rendered), ['content-type', 'text/html'] as const],
  });
  return `/${name}`;
}

const positions = (html: string): string[] => {
  const where = {
    message: html.indexOf('id="continue"'),
    frames: html.indexOf('<iframe'),
    script: html.indexOf('<script nonce='),
  };
  return Object.entries(where)
    .sort((a, b) => a[1] - b[1])
    .map(([part]) => part);
};

describe('the redirecting logged-out page in a real browser', () => {
  it.each(ORDERINGS.map((order) => [order.join(' '), order] as const))(
    'leaves after its frames loaded, whatever the order: %s',
    async (_name, order) => {
      const path = publish(`order-${order.join('-')}`, order);
      expect(positions(pages.get(path)?.html ?? '')).toEqual([...order]);
      hits.length = 0;
      const context = await browser.newContext();
      const page = await context.newPage();
      const refused: string[] = [];
      page.on('console', (message) => {
        if (/content security policy/iu.test(message.text())) refused.push(message.text());
      });
      const started = Date.now();
      await page.goto(`http://${PAGE_HOST}:${String(port)}${path}`, {
        waitUntil: 'domcontentloaded',
      });
      const continues = await page.evaluate(
        () => (document.getElementById('continue') as HTMLAnchorElement | null)?.href ?? null,
      );
      expect(continues).toBe(`http://${PAGE_HOST}:${String(port)}/after`);
      await page.waitForURL(`http://${PAGE_HOST}:${String(port)}/after`, { timeout: 10_000 });
      await context.close();
      const frames = hits.filter((hit) => hit.path.startsWith('/frame/'));
      const after = hits.find((hit) => hit.path === '/after');
      expect(frames).toHaveLength(2);
      expect(after).toBeDefined();
      for (const frame of frames) expect(after?.at ?? 0).toBeGreaterThanOrEqual(frame.at);
      expect((after?.at ?? Infinity) - started).toBeLessThan(SCRIPT_LEAVES_BY_MS);
      expect(refused).toEqual([]);
    },
  );

  it('blocks an inline script that carries no nonce, and still leaves', async () => {
    const path = publish('injected', ORDERINGS[0], '<script>window.injected = true</script>');
    hits.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/iu.test(message.text())) refused.push(message.text());
    });
    await page.goto(`http://${PAGE_HOST}:${String(port)}${path}`, {
      waitUntil: 'domcontentloaded',
    });
    const ran = await page.evaluate(() => 'injected' in window);
    expect(ran).toBe(false);
    await page.waitForURL(`http://${PAGE_HOST}:${String(port)}/after`, { timeout: 10_000 });
    await context.close();
    expect(refused.length).toBeGreaterThan(0);
  });
});
