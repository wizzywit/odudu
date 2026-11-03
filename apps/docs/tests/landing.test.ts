import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { JOURNEYS, SECTIONS } from '#docs/nav.ts';
import { FOLLOW_UP } from '#docs/src/features/landing/services/installCommands.ts';
import { RELEASE_CAVEAT } from '#docs/src/features/landing/services/release.ts';
import { LAYOUTS } from '#docs/src/features/landing/services/sceneLayouts.ts';
import { travelKeyframes } from '#docs/src/features/landing/services/sceneMotion.ts';
import { PAGES_BASE, PAGES_DOCS_BASE } from '#docs/site.config.ts';
import { TIME_CLAIM, TIME_CLAIM_EXAMPLES } from '#docs/tests/support/claims.ts';
import { DOCS_ROOT, distDir, fileOf, load, walk } from '#docs/tests/support/dist.ts';

const REPO_ROOT = path.resolve(DOCS_ROOT, '../..');
const NOTICE =
  'Odudu and the staff mark are the property of Wisdom Praise. The software is licensed under the AGPL; the name and the mark are used under the trademark policy.';

const $ = load(path.join(distDir('pages'), 'index.html'));
const landing = $('[data-page="landing"]');

function quickStartCommand(): string {
  const source = readFileSync(path.join(DOCS_ROOT, 'content/en/quick-start/index.mdx'), 'utf8');
  const first = fromMarkdown(source.replace(/^---\n[\s\S]*?\n---\n/u, '')).children.find(
    (node) => node.type === 'code',
  );
  if (first?.type !== 'code') throw new Error('the quick start has no code block');
  return first.value;
}

function hrefs(scope: ReturnType<typeof $>): string[] {
  return scope
    .find('a[href]')
    .map((_, element) => $(element).attr('href') ?? '')
    .get();
}

function exists(href: string): boolean {
  const pathname = new URL(href, 'https://placeholder.test').pathname;
  const file = fileOf(distDir('pages'), PAGES_BASE, pathname);
  return file !== null && existsSync(file);
}

describe('the landing page as built', () => {
  it('is the page at the site root and has one h1', () => {
    expect(landing).toHaveLength(1);
    expect($('h1')).toHaveLength(1);
    expect(landing.find('h1')).toHaveLength(1);
  });

  it('prints the quick start command and no other, for each shell', () => {
    const command = quickStartCommand().trim();
    const printed = landing.find('code[data-shell]');
    expect(printed.length).toBeGreaterThanOrEqual(2);
    const unix = landing.find('code[data-shell="unix"]').text();
    expect(unix).toBe(command);
    const windows = landing.find('code[data-shell="windows"]').text();
    expect(windows).toContain('compose.yaml');
    expect(windows).toContain('docker compose up -d');
    expect(windows).toContain('curl.exe');
    for (const text of [unix, windows]) {
      expect(text).toMatch(/^[\x20-\x7e]+$/u);
    }
  });

  it('does not say where the name comes from', () => {
    const text = landing.text();
    expect(text).not.toMatch(/ibibio|akwa ibom|coined|means authority/iu);
  });

  it('says it is a release candidate, and what is planned is said to be planned', () => {
    const text = landing.text();
    expect(text).toMatch(/release candidate/iu);
    const ai = landing.find('[data-section="agents"]');
    expect(ai).toHaveLength(1);
    expect(ai.find('[data-planned]')).toHaveLength(2);
    expect(hrefs(ai)).not.toContain(`${PAGES_BASE}llms.txt`);
    expect(hrefs(landing.find('[data-section="browse"] [data-markdown]'))).toEqual([
      `${PAGES_BASE}llms.txt`,
    ]);
    expect(exists(`${PAGES_BASE}llms.txt`)).toBe(true);
  });

  it('presents Hosted Odudu as planned, with nothing to buy or join', () => {
    const hosted = landing.find('[data-section="hosted"]');
    expect(hosted).toHaveLength(1);
    expect(hosted.text()).toContain('in the works');
    expect(hosted.find('form, input, button, textarea, select')).toHaveLength(0);
    const links = hosted.find('a');
    expect(hrefs(hosted)).toEqual([`${PAGES_DOCS_BASE}roadmap/`]);
    const forbidden = /pricing|price|buy|checkout|sign.?up|subscribe|trial|waitlist|\$\d/iu;
    links.each((_, element) => {
      expect($(element).text()).not.toMatch(forbidden);
      expect($(element).attr('href') ?? '').not.toMatch(forbidden);
    });
    expect(hosted.text()).not.toMatch(/[$€£¥]/u);
    expect(landing.find('a[href^="mailto:"]')).toHaveLength(0);
    expect(landing.find('form')).toHaveLength(0);
  });

  it('collects nothing: its only inputs are the shell choice', () => {
    const inputs = landing.find('input');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.each((_, element) => {
      expect($(element).attr('type')).toBe('radio');
    });
  });

  it('lists at least six capabilities, each linking to a page the build wrote', () => {
    const items = landing.find('[data-section="capabilities"] li a[href]');
    expect(items.length).toBeGreaterThanOrEqual(6);
    for (const href of hrefs(landing.find('[data-section="capabilities"]'))) {
      expect(exists(href), href).toBe(true);
    }
  });

  it('has four reader paths, each linking to a page the build wrote', () => {
    const readers = landing
      .find('[data-section="readers"] a[href]')
      .not('[data-section="examples"] a');
    expect(readers).toHaveLength(4);
    for (const href of hrefs(landing.find('[data-section="readers"]')).filter((href) =>
      href.startsWith(PAGES_DOCS_BASE),
    )) {
      expect(exists(href), href).toBe(true);
    }
  });

  it('shows the four examples, each beside the guide that walks through it', () => {
    const examples = landing.find('[data-section="examples"] li');
    expect(examples).toHaveLength(4);
    const guides = hrefs(landing.find('[data-section="examples"] li')).filter((href) =>
      href.startsWith(`${PAGES_DOCS_BASE}guides/`),
    );
    expect(guides.sort()).toEqual(
      ['web-app', 'single-page-app', 'api', 'machine-to-machine']
        .map((name) => `${PAGES_DOCS_BASE}guides/${name}/`)
        .sort(),
    );
  });

  it('links every section of the documentation and every journey', () => {
    const all = hrefs(landing);
    for (const section of SECTIONS) expect(all).toContain(`${PAGES_DOCS_BASE}${section.route}`);
    for (const journey of JOURNEYS) expect(all).toContain(`${PAGES_DOCS_BASE}${journey.route}`);
  });

  it('links the comparison pages and the roadmap', () => {
    const compare = landing.find('[data-section="compare"]');
    expect(hrefs(compare)).toEqual(
      expect.arrayContaining([
        `${PAGES_DOCS_BASE}introduction/compare/`,
        `${PAGES_DOCS_BASE}guides/keycloak/`,
        `${PAGES_DOCS_BASE}roadmap/`,
      ]),
    );
  });

  it('puts the hero image first in the page: sized, high priority and never lazy', () => {
    const images = landing.find('img');
    const hero = images.first();
    expect(hero.attr('fetchpriority')).toBe('high');
    expect(hero.attr('loading')).toBeUndefined();
    expect(hero.attr('width')).toBeDefined();
    expect(hero.attr('height')).toBeDefined();
    expect(hero.attr('src') ?? '').toMatch(/\.webp$/u);
    images.each((_, element) => {
      const image = $(element);
      expect(image.attr('alt'), image.attr('src')).toBeDefined();
      expect(image.attr('width'), image.attr('src')).toBeDefined();
      expect(image.attr('height'), image.attr('src')).toBeDefined();
      if (image.attr('fetchpriority') === 'high') expect(image.attr('loading')).toBeUndefined();
    });
    const lazy = images.filter((_, element) => $(element).attr('loading') === 'lazy');
    expect(lazy.length).toBeGreaterThan(0);
  });

  it('carries the ownership notice exactly when the trademark policy exists', () => {
    const footer = $('footer').text();
    const present = existsSync(path.join(REPO_ROOT, 'TRADEMARK.md'));
    expect(footer.includes(NOTICE)).toBe(present);
  });

  it('names the licences of what it offers, and links where they are explained', () => {
    const licence = landing.find('[data-section="licence"]');
    expect(licence.text()).toContain('AGPL-3.0');
    expect(licence.text()).toContain('Apache-2.0');
    expect(hrefs(licence).some((href) => href.endsWith('/LICENSING.md'))).toBe(true);
  });
});

const roadmap = readFileSync(path.join(DOCS_ROOT, 'content/en/roadmap.md'), 'utf8');
const shipped = roadmap.slice(roadmap.indexOf('## Shipped'), roadmap.indexOf('## Next'));
const sessions = readFileSync(path.join(DOCS_ROOT, 'content/en/concepts/sessions.mdx'), 'utf8');

// What each named capability is held to: a line of the roadmap's Shipped
// section, or, for single sign-on, the Sessions page that explains it.
const EVIDENCE: Record<string, [string, RegExp]> = {
  passwords: [shipped, /Passwords with a policy and lockouts/u],
  passkeys: [shipped, /passkeys/u],
  'authenticator-codes': [shipped, /one-time password from an authenticator app/u],
  'single-sign-on': [shipped, /Single sign-on across the apps of one tenant/u],
  'back-channel-logout': [shipped, /back-channel logout delivered to the apps that registered/u],
};

describe('the sign-in scene', () => {
  const flow = landing.find('[data-section="signin"]');
  const captions = flow.find('[data-flow-captions] > li');

  it('has seven captions in order, and a scene for each layout with its own text alternative', () => {
    expect(captions).toHaveLength(7);
    captions.each((_, element) => {
      expect($(element).find('p').first().text().length).toBeGreaterThan(15);
    });
    const scenes = flow.find('svg[data-layout]');
    expect(scenes).toHaveLength(2);
    scenes.each((_, element) => {
      expect($(element).find('title').text()).not.toBe('');
      expect($(element).find('desc').text().length).toBeGreaterThan(40);
    });
  });

  it('says what it shows in everyday words, in the page itself', () => {
    const text = flow.text();
    for (const phrase of [
      'A person opens your app.',
      'Your app sends them to Odudu to sign in.',
      'Odudu sends them back with a signed pass, and your app lets them in.',
      'Odudu sees they are already signed in, so it shows no sign-in page.',
      'Sign out of one, and the apps that registered for it are told.',
    ]) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toMatch(/authorization code|pkce|oauth/iu);
  });

  it('names only what ships: every claim has a line in the roadmap, and nothing else is promised', () => {
    const claims = flow
      .find('[data-claim]')
      .map((_, element) => $(element).attr('data-claim') ?? '')
      .get();
    expect(new Set(claims)).toEqual(new Set(Object.keys(EVIDENCE)));
    for (const claim of new Set(claims)) {
      const [source, pattern] = EVIDENCE[claim] ?? ['', /^$/u];
      expect(source, claim).toMatch(pattern);
    }
    const chips = flow
      .find('[data-claim-chip]')
      .map((_, element) => $(element).attr('data-claim-chip') ?? '')
      .get();
    expect(new Set(chips)).toEqual(new Set(['passwords', 'passkeys', 'authenticator-codes']));
    expect(sessions).toMatch(/sent straight back signed in/u);
    expect(flow.text()).not.toMatch(
      /saml|google|github|social|ldap|federat|brokering|every app\b(?! of that tenant)|all apps/iu,
    );
  });

  it('links the pages that give the detail', () => {
    expect(hrefs(flow)).toEqual([
      `${PAGES_DOCS_BASE}concepts/sessions/`,
      `${PAGES_DOCS_BASE}concepts/tokens/`,
      `${PAGES_DOCS_BASE}guides/sign-a-user-in/`,
    ]);
  });
});

describe('the pages your users see', () => {
  const strip = landing.find('[data-section="pages"]');

  it('shows the four pages as real captures, in both themes, each page named', () => {
    const shots = strip.find('[data-strip] figure');
    expect(shots).toHaveLength(4);
    expect(strip.find('[data-row="large"] figure')).toHaveLength(2);
    expect(strip.find('[data-row="small"] figure')).toHaveLength(2);
    const names = shots
      .find('[data-caption]')
      .map((_, element) => $(element).text())
      .get();
    expect(names).toEqual(['Sign in', 'Create an account', 'Reset a password', 'Second factor']);
    for (const element of shots.find('img').get()) {
      const src = $(element).attr('src') ?? '';
      expect(src).toMatch(/\/server-pages\/[a-z-]+-(light|dark)\.webp$/u);
      expect(exists(src), src).toBe(true);
    }
  });
});

describe('the WordPress line', () => {
  it('is one plain line under the four apps, linking the guide the build wrote', () => {
    const line = landing.find('[data-example="wordpress"]');
    expect(line.text()).toBe('Also a hand-tested guide: sign in to WordPress.');
    expect(hrefs(line)).toEqual([`${PAGES_DOCS_BASE}guides/wordpress/`]);
    expect(exists(`${PAGES_DOCS_BASE}guides/wordpress/`)).toBe(true);
    expect(landing.find('[data-section="examples"] li')).toHaveLength(4);
  });
});

describe('the hero terminal', () => {
  it('replays only what the quick start shows', () => {
    const quick = readFileSync(path.join(DOCS_ROOT, 'content/en/quick-start/index.mdx'), 'utf8');
    expect(quick).toContain(FOLLOW_UP.command);
    for (const line of FOLLOW_UP.output) expect(quick).toContain(line);
    const shown = landing.find('[data-panel="unix"]').text();
    expect(shown).toContain(FOLLOW_UP.command);
    for (const line of FOLLOW_UP.output) expect(shown).toContain(line);
  });
});

describe('the landing page keeps its promises small', () => {
  const landingSources = [
    ...walk(path.join(DOCS_ROOT, 'src/features/landing'))
      .filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
      .map((file) => path.relative(DOCS_ROOT, file)),
    'src/pages/index.tsx',
  ];
  const text = (file: string): string => load(path.join(distDir('pages'), file))('body').text();

  it('recognises the phrasings it bans, and only those', () => {
    for (const phrase of TIME_CLAIM_EXAMPLES.caught) expect(phrase).toMatch(TIME_CLAIM);
    for (const phrase of TIME_CLAIM_EXAMPLES.allowed) expect(phrase).not.toMatch(TIME_CLAIM);
  });

  it('promises no length of time, in any source of the page or in what it builds', () => {
    expect(landingSources.length).toBeGreaterThan(8);
    for (const file of landingSources) {
      expect(readFileSync(path.join(DOCS_ROOT, file), 'utf8'), file).not.toMatch(TIME_CLAIM);
    }
    expect(landing.text()).not.toMatch(TIME_CLAIM);
    expect(text('index.html')).not.toMatch(TIME_CLAIM);
    expect(text('docs/quick-start/index.html')).not.toMatch(TIME_CLAIM);
  });

  it('carries the release caveat on the landing page and the Quick start until a stable release is in the changelog', () => {
    // `releases/latest/download` skips pre-releases, so the address answers
    // only once a stable version has a dated section.
    const stable = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/mu.test(
      readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'),
    );
    const quick = readFileSync(path.join(DOCS_ROOT, 'content/en/quick-start/index.mdx'), 'utf8');
    const note = landing.find('[data-install-note]').text();
    const advice = stable
      ? `CHANGELOG.md has a stable release: remove "${RELEASE_CAVEAT}" from Install.tsx and the Quick start once the download address answers`
      : `no stable release yet: "${RELEASE_CAVEAT}" must stay in Install.tsx and in the Quick start until the first stable release is published`;
    expect(note.includes(RELEASE_CAVEAT), advice).toBe(!stable);
    expect(quick.includes(RELEASE_CAVEAT), advice).toBe(!stable);
  });

  it('has at most eleven bands, and no picture below the first screen is fetched eagerly', () => {
    expect(landing.find('> header, > section').length).toBeLessThanOrEqual(11);
    const images = landing.find('img');
    const eager = images.filter((_, element) => $(element).attr('loading') !== 'lazy');
    expect(eager).toHaveLength(1);
    expect(eager.attr('fetchpriority')).toBe('high');
    expect(landing.find('img[src*="/console/"]').length).toBeLessThanOrEqual(2);
  });

  it('keeps the mark printable: the mask gives way to the file itself', () => {
    const css = readdirSync(path.join(distDir('pages'), 'assets/css'))
      .map((file) => readFileSync(path.join(distDir('pages'), 'assets/css', file), 'utf8'))
      .join('');
    expect(css).toMatch(/@media print\{[^@]*lockup[^@]*mask:none/u);
  });

  it('ships the travelling-signal keyframes once, in the stylesheet, and not in the markup or the script', () => {
    const generated = readFileSync(
      path.join(DOCS_ROOT, 'src/features/landing/ui/Scene/travel.css'),
      'utf8',
    );
    expect(generated.trim(), 'run: node scripts/landing-keyframes.ts').toBe(travelKeyframes());
    expect(readFileSync(path.join(distDir('pages'), 'index.html'), 'utf8')).not.toContain(
      '@keyframes travel-',
    );
    const css = readdirSync(path.join(distDir('pages'), 'assets/css'))
      .map((file) => readFileSync(path.join(distDir('pages'), 'assets/css', file), 'utf8'))
      .join('');
    expect(css.match(/@keyframes travel-wide-dh/gu)).toHaveLength(1);
    const scripts = walk(path.join(distDir('pages'), 'assets/js'))
      .filter((file) => file.endsWith('.js'))
      .filter((file) => readFileSync(file, 'utf8').includes('@keyframes travel-'));
    expect(scripts).toEqual([]);
  });

  it('keeps the scene apart: no window touches another, with App B at its lowest offset', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const boxes = [
        layout.device,
        layout.hub,
        layout.appA,
        { ...layout.appB, y: layout.appB.y + 16 },
      ];
      boxes.forEach((first, index) => {
        boxes.slice(index + 1).forEach((second) => {
          const gapX = Math.max(first.x - (second.x + second.w), second.x - (first.x + first.w));
          const gapY = Math.max(first.y - (second.y + second.h), second.y - (first.y + first.h));
          expect(Math.max(gapX, gapY), JSON.stringify([first, second])).toBeGreaterThanOrEqual(12);
        });
      });
    }
  });

  it('names the font licences beside the licence line', () => {
    const licence = landing.find('[data-section="licence"]');
    expect(hrefs(licence)).toEqual(
      expect.arrayContaining([
        `${PAGES_BASE}licenses/IBM-Plex-Sans-OFL-1.1.txt`,
        `${PAGES_BASE}licenses/IBM-Plex-Mono-OFL-1.1.txt`,
      ]),
    );
  });
});
