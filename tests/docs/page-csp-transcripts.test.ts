import { describe, expect, it } from 'vitest';
import { SHELL_CSP } from '../../packages/console-gateway/src/view/spa.js';
import {
  mailPreviewHeaders,
  pageHeaders,
  previewHeaders,
  servedAssetHeaders,
  type RenderedPage,
  type ResolvedBranding,
} from '../../packages/kernel/src/index.js';
import { docsPolicy, UNAVAILABLE_POLICY } from '../../packages/web-assets/src/index.js';
import { ADMIN_PAGES, CONSOLE_PAGES, loadSource, PROTOCOL_PAGES } from './markdown.js';

// A recorded `content-security-policy` is a claim about what the server sends.
// Each page's policy is rebuilt from what its own line says the page carries
// (a nonce, a framed origin, a redirect target) and handed to `pageHeaders`,
// so a directive added there fails every transcript that no longer shows it.
const GUIDES = [PROTOCOL_PAGES, CONSOLE_PAGES, ADMIN_PAGES];
const RECORDED = /^(?:[<>] )?content-security-policy: (.+)$/u;

interface Recorded {
  readonly where: string;
  readonly policy: string;
  // The other header lines of the block the policy sits in, prefix
  // (`< `, `> `) removed.
  readonly following: readonly string[];
}

function recorded(): Recorded[] {
  return GUIDES.flatMap((guide) =>
    loadSource(guide).lines.flatMap((line, index, all) => {
      const policy = RECORDED.exec(line)?.[1];
      if (policy === undefined) return [];
      const isHeader = (text: string | undefined): text is string =>
        text !== undefined && /^[a-z][a-z-]*: /u.test(text.replace(/^[<>] /u, ''));
      const around: string[] = [];
      for (let at = index - 1; isHeader(all[at]); at--) around.unshift(all[at] ?? '');
      for (let at = index + 1; isHeader(all[at]); at++) around.push(all[at] ?? '');
      const following = around.map((next) => next.replace(/^[<>] /u, ''));
      return [{ where: `${guide}:${String(index + 1)}`, policy, following }];
    }),
  );
}

function sources(directives: readonly string[], name: string): string[] | undefined {
  const found = directives.find((directive) => directive.startsWith(`${name} `));
  return found?.slice(name.length + 1).split(' ');
}

const STOCK_ICONS = ['/instrument/favicon.svg', '/instrument/favicon.ico'];

// A themed page names each stylesheet and image in full instead of `'self'`.
// The theme that would send those names is rebuilt from them: the origin from
// the first, the tenant's stylesheet as the second, every image that is not
// one of Instrument's own icons as an asset.
function brandingOf(directives: readonly string[]): ResolvedBranding | undefined {
  const style = sources(directives, 'style-src') ?? [];
  const first = style[0];
  if (!first?.startsWith('http')) return undefined;
  const origin = new URL(first).origin;
  const path = (url: string): string => url.slice(origin.length);
  const second = style[1];
  return {
    origin,
    templates: {},
    tokensCss: '',
    stylesheetUrl: second === undefined ? null : path(second),
    faviconUrl: null,
    logo: null,
    assetUrls: (sources(directives, 'img-src') ?? [])
      .map(path)
      .filter((url) => !STOCK_ICONS.includes(url)),
  };
}

function pageOf(policy: string): RenderedPage {
  const directives = policy.split('; ');
  const nonce = /^'nonce-(.+)'$/u.exec(sources(directives, 'script-src')?.[0] ?? '')?.[1];
  const formAction = sources(directives, 'form-action') ?? [];
  const branding = brandingOf(directives);
  return {
    html: '',
    body: '',
    title: '',
    script:
      nonce === undefined
        ? null
        : { nonce, fetchesSameOrigin: sources(directives, 'connect-src') !== undefined },
    frames: sources(directives, 'frame-src') ?? [],
    locale: { tag: 'en', dir: 'ltr', ...(branding === undefined ? {} : { branding }) },
    ...(formAction[1] === undefined ? {} : { redirectsTo: formAction[1] }),
  };
}

function policyOf(page: RenderedPage): string {
  return pageHeaders(page).find(([name]) => name === 'content-security-policy')?.[1] ?? '';
}

function otherHeaders(page: RenderedPage): string[] {
  return pageHeaders(page)
    .filter(([name]) => name !== 'content-security-policy')
    .map(([name, value]) => `${name}: ${value}`);
}

// A script's nonce is 16 random bytes, base64 with padding.
const NONCE = /^'nonce-[A-Za-z0-9+/]{22}=='$/u;
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/u;

// The built documentation answers under a policy of its own, and says noindex
// in a header no page of the server sends. Its recordings are checked below.
function isDocs(line: Recorded): boolean {
  return line.following.includes('x-robots-tag: noindex, nofollow');
}

// The theme preview and the mail preview are responses of their own, framed
// by the console, which is the one policy that ends in `frame-ancestors 'self'`.
function isPreview(line: Recorded): boolean {
  return (
    line.policy.startsWith("default-src 'none'") && line.policy.endsWith("frame-ancestors 'self'")
  );
}

// A tenant's uploaded image or stylesheet, served as itself rather than as a
// page, sends the one policy that leaves a browser nothing to run or load.
function isServedAsset(line: Recorded): boolean {
  return line.policy === "default-src 'none'; sandbox";
}

describe('the content-security-policy lines the guides record', () => {
  const everything = recorded();
  const lines = everything.filter(
    (line) => !isDocs(line) && !isPreview(line) && !isServedAsset(line),
  );
  const assets = everything.filter(isServedAsset);
  const docs = everything.filter(isDocs);
  const previews = everything.filter(isPreview);

  it('shows a theme preview and a mail preview as their own builders send them', () => {
    expect(previews.length).toBeGreaterThan(1);
    const drift = previews.flatMap((line) => {
      const directives = line.policy.split('; ');
      const style = sources(directives, 'style-src') ?? [];
      const hash = style.find((source) => source.startsWith("'sha256-"))?.slice(8, -1) ?? null;
      const images = (sources(directives, 'img-src') ?? []).filter((source) => source !== 'data:');
      const sent = style.includes("'unsafe-inline'")
        ? mailPreviewHeaders(images)
        : previewHeaders({ html: '', styleSha256: hash, scriptOmitted: false });
      const policy = sent.find(([name]) => name === 'content-security-policy')?.[1];
      return [
        ...(policy === line.policy ? [] : [`${line.where}: expected ${String(policy)}`]),
        ...sent
          .filter(([name]) => name !== 'content-security-policy')
          .map(([name, value]) => `${name}: ${value}`)
          .filter((header) => !line.following.includes(header))
          .map((header) => `${line.where}: missing ${header}`),
      ];
    });
    expect(drift).toEqual([]);
  });

  it('shows a served image or stylesheet with the headers the kernel sends it', () => {
    expect(assets.length).toBeGreaterThan(1);
    const drift = assets.flatMap((line) => {
      const reach = line.following.includes('cross-origin-resource-policy: same-origin')
        ? 'same-origin'
        : 'cross-origin';
      return servedAssetHeaders(reach)
        .map(([name, value]) => `${name}: ${value}`)
        .filter((header) => !line.following.includes(header) && !header.startsWith('content-'))
        .map((header) => `${line.where}: missing ${header}`);
    });
    expect(drift).toEqual([]);
  });

  it('finds a recorded policy in each guide, so an empty scan cannot pass', () => {
    for (const guide of GUIDES) {
      expect(
        lines.some((line) => line.where.startsWith(`${guide}:`)),
        guide,
      ).toBe(true);
    }
  });

  it('shows every page policy as pageHeaders sends it', () => {
    const pages = lines.filter((line) => line.policy.startsWith("default-src 'none'"));
    expect(pages.length).toBeGreaterThan(10);
    const drift = pages
      .filter((line) => policyOf(pageOf(line.policy)) !== line.policy)
      .map((line) => `${line.where}: ${line.policy}\n  expected ${policyOf(pageOf(line.policy))}`);
    expect(drift).toEqual([]);
  });

  it('shows the headers that ride beside a page policy as pageHeaders sends them', () => {
    const pages = lines.filter((line) => line.policy.startsWith("default-src 'none'"));
    const whole = pages.filter((line) => line.following.includes('x-frame-options: DENY'));
    expect(whole.length).toBeGreaterThan(10);
    const drift = whole.flatMap((line) =>
      otherHeaders(pageOf(line.policy))
        .filter((header) => !line.following.includes(header))
        .map((header) => `${line.where}: missing ${header}`),
    );
    expect(drift).toEqual([]);
  });

  it('shows the console shell forbidding a sniffed type, where it records its headers whole', () => {
    const shell = lines.filter(
      (line) =>
        line.policy.startsWith("default-src 'self'") &&
        line.following.includes('x-frame-options: DENY'),
    );
    expect(shell.length).toBeGreaterThan(0);
    expect(
      shell
        .filter((line) => !line.following.includes('x-content-type-options: nosniff'))
        .map((line) => line.where),
    ).toEqual([]);
  });

  it('records a script only as one nonce, with connect-src alone beside it', () => {
    const pages = lines.filter((line) => line.policy.startsWith("default-src 'none'"));
    const scripted = pages.filter((line) => line.policy.includes('script-src'));
    expect(scripted.length).toBeGreaterThan(0);
    const bad = pages.flatMap((line) => {
      const directives = line.policy.split('; ');
      const script = sources(directives, 'script-src');
      const connect = sources(directives, 'connect-src');
      const ok =
        script === undefined
          ? connect === undefined
          : script.length === 1 &&
            NONCE.test(script[0] ?? '') &&
            (connect === undefined || (connect.length === 1 && connect[0] === "'self'"));
      return ok ? [] : [line.where];
    });
    expect(bad).toEqual([]);
  });

  it('records frame-src only as a list of bare origins', () => {
    // The shell's own policy is held to the gateway's exact string below.
    const framed = lines.filter(
      (line) => line.policy.includes('frame-src ') && !line.policy.startsWith("default-src 'self'"),
    );
    expect(framed.length).toBeGreaterThan(0);
    const bad = framed
      .filter((line) =>
        (sources(line.policy.split('; '), 'frame-src') ?? []).some((o) => !ORIGIN.test(o)),
      )
      .map((line) => line.where);
    expect(bad).toEqual([]);
  });

  it('shows the console shell policy as the gateway sends it', () => {
    const shell = lines.filter((line) => line.policy.startsWith("default-src 'self'"));
    expect(shell.length).toBeGreaterThan(0);
    expect(shell.filter((line) => line.policy !== SHELL_CSP).map((line) => line.where)).toEqual([]);
  });

  it('records no policy of a third shape', () => {
    const other = lines.filter(
      (line) =>
        !line.policy.startsWith("default-src 'none'") &&
        !line.policy.startsWith("default-src 'self'"),
    );
    expect(other.map((line) => line.where)).toEqual([]);
  });

  it('shows the documentation policy as docsPolicy makes it from the hashes the line names', () => {
    const served = docs.filter((line) => line.policy.startsWith("default-src 'self'"));
    expect(served.length).toBeGreaterThan(0);
    const hashes = (name: string, policy: string): string[] =>
      (sources(policy.split('; '), name) ?? []).filter((source) => source.startsWith("'sha256-"));
    const unquote = (list: string[]): string[] => list.map((hash) => hash.slice(1, -1));
    const drift = served
      .filter(
        (line) =>
          docsPolicy({
            scriptHashes: unquote(hashes('script-src', line.policy)),
            styleAttributeHashes: unquote(hashes('style-src-attr', line.policy)),
          }) !== line.policy,
      )
      .map((line) => line.where);
    expect(drift).toEqual([]);
    expect(served.filter((line) => /unsafe-inline|unsafe-eval/u.test(line.policy))).toEqual([]);
  });

  it('shows a documentation response with no page to load as the unavailable policy', () => {
    const bare = docs.filter((line) => line.policy.startsWith("default-src 'none'"));
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.filter((line) => line.policy !== UNAVAILABLE_POLICY).map((l) => l.where)).toEqual(
      [],
    );
  });

  it('records the documentation headers beside its policy whole', () => {
    const whole = docs.filter((line) => line.following.includes('x-frame-options: DENY'));
    expect(whole.length).toBeGreaterThan(0);
    const drift = whole.flatMap((line) =>
      ['referrer-policy: no-referrer', 'x-content-type-options: nosniff', 'content-language: en']
        .filter((header) => !line.following.includes(header))
        .map((header) => `${line.where}: missing ${header}`),
    );
    expect(drift).toEqual([]);
  });
});
