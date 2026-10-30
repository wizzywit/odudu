# P4g — public release

What the phase found while building it, in the shape `docs/phases/p4e.md`
follows. The phase's argument is in
[its design](../archive/specs/2026-10-15-p4g-public-release-design.md)
and [its plan](../archive/plans/2026-10-15-p4g-public-release.md).

## Spikes

### Rspress was evaluated and dropped

Rspress 2.0.23 was run in a scratch directory on 2026-10-16 (build, base paths,
CSP inventory, search, custom home, `light-dark()`, head, sitemap, Lighthouse)
and worked: one search index, one inline script, a hashed policy with no
violation, a stock page at performance 0.99. It was chosen for a Vue-docs look
and dropped on 2026-10-19 for **adoption**: the community, the plugin and theme
ecosystem and the number of people who already know the framework are small
next to Docusaurus, and the owner's look requirement is only clean, smooth,
searchable and mobile-first. Where it differed from Docusaurus: its CSS
pipeline downlevelled `light-dark()` into a hack that ignored the theme toggle
(Docusaurus's does not, below), it injected three run-time `<style>` elements
(Docusaurus injects none), it has local search built in (Docusaurus needs a
plugin) and I recall it having LLM-oriented output built in, which I did not
verify.

### The site: Docusaurus, scratch run

2026-10-19. `@docusaurus/core`, `preset-classic`, `faster` 3.10.2 (latest
stable, published 2026-07-10; `next` 3.0.0-rc.1, `canary` 4.0.0-canary-6985),
React 19.3.0, pnpm 12.3.4, Node 24.15.0, Playwright 1.63.0 on its cached
Chromium 1217, `@lhci/cli` 0.15.1, in a scratch workspace with this
repository's `.npmrc` and `pnpm-workspace.yaml` settings. Every line is a
command that was run; `assumption:` marks what was not.

- **Install.** Node `>=20.0`; React `^18 || ^19`, `react-dom` and
  `@mdx-js/react ^3` are peers the app installs. `minimumReleaseAge` and
  `engine-strict` did not refuse it; pnpm raised `ERR_PNPM_IGNORED_BUILDS`
  until `allowBuilds` named `@swc/core` and `core-js`, both `false` (the build
  does not need either postinstall). One `react` (19.3.0), no `vite`; the
  `react` pin is by convention, since no lint holds it. `tsc --noEmit` with
  `@docusaurus/tsconfig` is clean. A late `pnpm add` left a dangling
  `node_modules` link (pnpm 12.3.4) until the lockfile was regenerated.
  `docusaurus --version` fails without a site; `docusaurus build --help`
  works.
- **Two contradictions of the Rspress-era plan, both small.** A
  `"type": "module"` package fails the build (`require.resolveWeak is not a
function`), so the docs package is CommonJS. `future: { faster: true }`
  alone is refused; `future: { v4: true }` is what selects rspack.
- **Base.** `baseUrl` is a build input and the persistent cache is keyed by
  it: five alternating builds (`/odudu/`, `/docs/`, `/odudu/`, `/docs/`, `/`)
  on one cache each emitted only their own base. The cache is **not** keyed by
  environment-driven config: `markdown.format` changed from `detect` to `mdx`
  served the old compile until `docusaurus clear`. Root-relative Markdown links
  (`/intro/`) get the base prefix and are checked.
- **Inline script and style, strict CSP.** One executable inline `<script>`
  per page (626 bytes), `application/ld+json` blocks (not executed), no
  `<style>` element, and 12 distinct `style=` values over the site plus the
  three path documents (code-block theme colours). `baseUrlIssueBanner: false`
  removes a second script and six values from `index.html`. A Chromium walk
  (mobile menu, theme toggle, search, code copy, landing) under a policy of
  `script-src` one hash, `style-src 'self'` and `style-src-attr 'unsafe-hashes'`
  with the 12 hashes reported zero violations and no external request; without
  the style hashes it reported violations. Docusaurus is not strict-CSP clean; the
  hashed design stands, smaller than the Rspress one.
- **Search.** None built in. `@easyops-cn/docusaurus-search-local` 0.55.3
  (published 2026-07-29; peers `theme-common ^2 || ^3`, React to 19) installs,
  builds one same-origin `search-index.json` (4.1 MB raw, 1.09 MB gzip over the
  unsplit documents) and a `/search/` page that the sitemap includes until
  excluded; 18 suggestions for a term, no external request. It declares no
  Docusaurus 4 range, and `hashed: true` left the index unhashed. Offline use
  with the network disabled was not run: assumption.
- **Markdown.** Under `markdown.format: 'detect'` all 1,408 fenced blocks of the
  three path documents render byte for byte (trailing newline aside); `{{ }}`
  and `{ }` are literal in `.md`; a bare `<tenant>` in prose is parsed as HTML
  and a `<script>` in prose is live; `.mdx` evaluates braces and rejects
  `<!--`. The three documents hold 32 Markdown links to files outside the docs
  plugin (`../README.md`, `adr/…`) that fail the build.
- **Build size and time.** The whole scratch site with the three documents and
  search builds in 4 to 7 s. `request-paths` is 1.38 MB of HTML (183 KB gzip),
  `admin-paths` 1.26 MB (191 KB), `console-paths` 0.29 MB (35 KB), and a page
  that size loads a 157 KB content chunk on top: 332 KB of JavaScript, so the
  split by section stays required.
- **Home.** `src/pages/index.tsx` coexists with the docs plugin at
  `routeBasePath: '/'` and keeps the navbar, search and theme toggle. For the
  image the pages plugin's `path` points at `src/image-pages`; without a page at
  `/` the image has no `index.html`, and `plugin-client-redirects` as a
  substitute adds an inline script.
- **Tokens.** The console's `tokens.css` imports by relative path and Infima's
  `--ifm-*` are set from it. All eight {system light, system dark} x {initial,
  three toggle clicks} states followed the toggle with the default
  `browserslist` (lightningcss emitted its fallbacks and was still correct) and
  with a modern one (native `light-dark()`, 82.7 KB of CSS against 90.6 KB).
  On a phone the colour toggle is in the mobile menu.
- **Head, sitemap, languages.** The theme emits `<html lang>`, title,
  description, `og:*`, canonical, `hreflang` with `x-default` and a
  `BreadcrumbList` per docs page itself; `og:type`, `og:site_name`, `og:image`
  and `twitter:image` it does not (the last two from `themeConfig.image`:
  assumption). The minifier strips attribute quotes, so tests parse HTML. The
  sitemap is absolute from `url` + `baseUrl`, per locale (the root one lists no
  `/fr/` URL). `i18n/fr/docusaurus-plugin-content-docs/current/` builds `/fr/`
  with `lang="fr"`, alternates on both languages' pages and its own index;
  untranslated pages appear in English. A `robots.txt` under `/odudu/` is not
  read by crawlers. The image build keeps canonical, `hreflang`, `og:url` and
  JSON-LD whatever the config says; a 12-line `postBuild` plugin removes them
  (verified).
- **Raw imports and fence meta.** `!!raw-loader!` fails under rspack even with
  `raw-loader` installed; `?raw` with a 6-line `configureWebpack` rule
  (`resourceQuery: /raw/, type: 'asset/source'`) renders a file outside the
  docs root byte for byte. A fence's `{run expect="…"}` builds and is not
  rendered; `title="…"` is used. A generated `.md` page in a routed directory
  needs no registration.
- **Agent copies.** `docusaurus-plugin-llms` 0.6.1 (published 2026-10-03,
  peer `@docusaurus/core ^3`) writes `llms.txt` (absolute links from the site
  address; origin-relative with `useRelativeUrls` for the image),
  `llms-full.txt` and one `.md` per page. An `.mdx` page's copy is not rendered
  (imports stay, components vanish); `llms-full.txt` leaves relative links.
- **Lighthouse, 3 runs per URL, median, mobile profile.** Against
  `docusaurus serve` (uncompressed, and it answers `/robots.txt` with HTML):
  performance 0.82, LCP 4.8 s, SEO 0.92. Against a compressing static server:
  landing performance 0.98, accessibility 1.00, best practices 1.00, SEO 1.00,
  LCP 2,332 ms, CLS 0, TBT 31 ms; stock docs pages performance 0.98 to 0.99,
  LCP 1,923 to 2,377 ms, TBT 71 to 74 ms; the unsplit `console-paths` page
  0.96, LCP 2,523 ms. Accessibility was 0.92 to 0.96 before two
  configuration fixes (`--ifm-link-decoration: underline`, `prism` themes
  `github` and `dracula`) and an opacity reveal measured as contrast 1.16, so
  the reveal is transform only. First-load JavaScript: 161.7 KB gzip on the
  landing page, 179.8 KB on a docs page, plus 16.2 KB of CSS, so the 200 KB
  budget holds. The LCP headroom on the landing page is 168 ms, the real
  Core Web Vitals risk. lhci's `startServerReadyPattern` did not match
  `docusaurus serve` and it left that server running.
- **Swizzling.** None was needed for anything above: navbar, footer, colours,
  fonts, code themes and the accessibility fixes are configuration or CSS. The
  places a swizzle would appear are the code block (inline styles, if the CSP
  is ever made strict) and `@theme/SiteMetadata`.

Not verified, carried by the plan as assumptions: offline search with the
network off, `themeConfig.image`'s tags, `staticDirectories` per target,
`llms-full.txt` link rewriting, the docs plugin ignoring `.ts` files, a Chrome
on `ubuntu-latest`, Pages compressing responses, Firefox and WebKit with
`animation-timeline`, reduced-motion computed styles re-run on this stack,
`releases/latest/download` resolving to the newest non-prerelease asset and the
PNG social image reading well in link previews.

### The site: Docusaurus, workspace run

2026-10-19. The scratch findings above repeated in a throwaway worktree of this
repository's workspace (`apps/docs-spike`, never committed), with the real
lockfile, `.npmrc`, `pnpm-workspace.yaml` and lint configuration. Node 24.15.0,
pnpm 12.3.4, TypeScript 6.0.3, Playwright 1.63.0 (Chromium 153), `@lhci/cli`
0.15.1. `verified:` is a command that was run; `assumption:` was not.

Almost everything repeated. What differs from the scratch run and from the
plan, each with the change it needs:

- **The `#/` import alias does not exist in the docs app, and the
  no-relative-imports lint does reach it.** The lint's `apps/*/src/**` glob
  covers the app, so `import styles from './index.module.css'` is an error.
  `"imports": {"#/*": "./src/*"}` in `package.json` fails the build (rspack:
  `specifier is not a valid subpath for the "exports" resolution`). Docusaurus's
  own `@site` alias works, passes the lint, and needs `"paths": {"@site/*":
["./*"]}` in the tsconfig. Plan change: pages and components import through
  `@site/src/…`, never `#/`; no change to `eslint.config.js` for this.
  verified: `eslint apps/docs-spike/docusaurus.config.ts apps/docs-spike/src`
  (clean with `@site`, one `no-restricted-imports` error with `./`).
- **Ignore lists need `.docusaurus`, and the output directory should sit under
  `dist/`.** Generated `.docusaurus/` is untracked, not git-ignored, and both
  `eslint apps/docs-spike` and `prettier --check apps/docs-spike` crawl it (29
  prettier warnings there alone); `build/` is git-ignored but linted, and an
  out dir such as `dist-pages` is neither. `--out-dir dist/pages` and
  `dist/image` ride the existing `dist` rules in `.gitignore`, `.prettierignore`
  and the eslint `**/dist/**` ignore. Plan change: `.docusaurus` joins
  `.gitignore`, `.prettierignore` and the eslint `ignores`, and the build
  scripts pass `--out-dir dist/<target>`, `lhci` writes under `dist/` too.
  verified: `docusaurus build --out-dir dist/pages` exits 0 with a nested path.
- **tsconfig and the type-aware lint need four direct dependencies and a
  `.d.ts`.** `@docusaurus/tsconfig` sets `baseUrl`, which TypeScript 6.0.3
  rejects (`TS5101`) without `"ignoreDeprecations": "6.0"`. `@theme/*`, CSS
  modules and `@docusaurus/Head` resolve only with
  `src/docusaurus-env.d.ts` holding `/// <reference types="@docusaurus/module-type-aliases" />` and the same for `@docusaurus/theme-classic`, and both
  packages, plus `@types/react` 19.3.0 and `prism-react-renderer` 2.4.1 (for
  `themes`, otherwise `no-unsafe-member-access`), must be direct dependencies
  because pnpm does not hoist them. `docusaurus.config.ts` stays out of the
  tsconfig `include`: with it in, eslint refuses (`was included by
allowDefaultProject but also was found in the project service`), because
  `apps/*/*.config.ts` is already an `allowDefaultProject` glob; type-aware
  eslint then checks it through the default project and `tsc` does not.
  verified: `tsc --noEmit -p apps/docs-spike` (clean) and the eslint command
  above (clean), after those edits.
- **`tests/docs/references.test.ts` fails on a copied document.** It globs
  `**/*.md` and resolves each relative link against the file that holds it;
  `request-paths`, `admin-paths` and `console-paths` copied into
  `content/en/` fail with 20 unresolved links (`../README.md`, `adr/…`,
  `protocols/…`, `../infra/…`). The same links fail the Docusaurus build once
  `onBrokenLinks` is `throw` (a page lists each once; 32 occurrences are
  reported while `onBrokenMarkdownLinks` is `warn`). Plan change for the task
  that moves the documents: rewrite those links to absolute repository URLs
  (they leave the docs plugin), not leave them to a lenient build.
  verified: `node_modules/.bin/vitest run --project unit tests/lint tests/docs`
  in the worktree (`references.test.ts` fails on the copies; the other two
  failures are `apps/admin-console/dist` missing, unrelated).
- **A `pnpm add` after the first install leaves dangling links, confirmed in
  this workspace.** `@docusaurus/module-type-aliases` and `prism-react-renderer`
  pointed at store paths without their peer suffix; `pnpm install` said "Lockfile
  is up to date". `git checkout pnpm-lock.yaml`, delete
  `apps/docs-spike/node_modules`, `pnpm install` repaired it. So the docs
  package goes in with every dependency in its `package.json` and one install.
  verified: `ls apps/docs-spike/node_modules/@docusaurus/module-type-aliases`
  empty before, populated after.
- **The lockfile diff is large but touches nothing existing.** 811 packages
  before, 2,026 after, none removed and none changed in version; 4,648 existing
  snapshot lines were rewritten (peer-context suffixes on `vite`, `vitest`,
  `eslint`, `playwright` entries) because the new tree adds peer contexts. A
  reviewer should expect a 20,000-line lockfile hunk.
  verified: `git diff --stat pnpm-lock.yaml` and a set comparison of the
  `packages:` keys.
- **`allowBuilds` needs exactly the two entries, and `minimumReleaseAge` and
  `engine-strict` do not refuse anything.** pnpm printed
  `ERR_PNPM_IGNORED_BUILDS` (`@swc/core@1.16.18`, `core-js@3.50.0`) until
  `'@swc/core': false` and `core-js: false` were added to `allowBuilds`; it also
  writes `<name>: set this to true or false` placeholders into
  `pnpm-workspace.yaml`, which collide with hand-written keys as duplicate
  mapping keys, so edit the file, not the placeholders. verified: `pnpm add …`
  then `pnpm install` in the worktree.
- **"No `vite`" cannot hold in this workspace**: `admin-console` already brings
  `vite@8.3.1` (two instances, before and after). What holds: the docs app adds
  no `vite` and exactly one `react` and one `react-dom`. verified:
  `ls node_modules/.pnpm | grep -E "^(react|react-dom|vite)@"` (`react@19.3.0`,
  `react-dom@19.3.0_react@19.3.0`, the two `vite@8.3.1` already present).
- **The pages plugin's `path` is set through the preset**
  (`pages: { path: … }`); adding `@docusaurus/plugin-content-pages` to
  `plugins` fails with a duplicate plugin ID. A plugin in `plugins` must be a
  function, not an object. verified: both failures hit and fixed during the run.
- **`colorMode: { respectPrefersColorScheme: true }` is required** for the
  first paint to follow the system; without it a dark-system visitor starts in
  light. verified: Playwright, below.

S1 (whole documents). verified: `docusaurus build` of the three documents as
single pages, with `markdown.format: 'detect'`, two locales: 6.5 s cold, 2.4 s
cached. HTML: `request-paths` 1,369,038 bytes (182,017 gzip), `admin-paths`
1,262,135 (191,522), `console-paths` 287,015 (34,517). All 1,408 fenced blocks
(646, 601, 161) are byte-identical to the source once each page's `.token-line`
rows are joined with newlines (script: cheerio over the built HTML); the sizes
match the scratch run. The `<tenant>`-in-prose and `<script>`-in-prose
observations were not re-run: assumption (carried).

S2 (home, tokens, motion). A CSS-module reveal (`animation-timeline: view()`
inside `@supports` and `prefers-reduced-motion: no-preference`, transform only),
the console's `tokens.css` imported by relative path from `custom.css` (a CSS
`@import`, not reached by the lint), a modern `browserslist`.

- verified: Playwright 1.63.0, Chromium 153, `reducedMotion: 'reduce'` gives
  computed `animation-name: none`; `no-preference` gives the `rise` animation,
  opacity 1 throughout. The carried assumption is now verified on this stack.
- verified: the navbar background follows `--surface-panel` in all eight
  {system light, system dark} x {initial, three toggle clicks} states (initial
  state matches the system with `respectPrefersColorScheme`; a click on a
  system-light page first stays light, then dark, light: the cycle is
  system, light, dark, so three clicks do not mean three changes).
- verified: first-load budget, gzip of every JavaScript and CSS response
  (`networkidle`): landing 148.9 KB JavaScript, docs page 166.5 KB, 14.6 KB CSS
  (search plugin not in this build), so Task 31's 200 KB holds with room.
- verified, on Playwright core 1.59.0 (see next): Firefox 148.0.2 does not
  support `animation-timeline: view()`; content is fully visible (`opacity: 1`,
  `transform: none`, no animation); WebKit 26.4 supports it and animates
  transform only with reduced motion giving `animation-name: none`. The default
  `opacity: 1` outside `@supports` is enough.
- **The cached Firefox and WebKit builds are not Playwright 1.63.0's.** 1.63.0
  wants `firefox-1543` and `webkit-2359`; the cache holds `1511` and `2272`,
  which are `playwright-core` 1.59.0's (`browsers.json`). Forcing the older
  binaries through 1.63.0 hangs (`Browser.setDefaultViewport` is rejected). The
  run used a throwaway `playwright-core@1.59.0` tarball under the scratchpad.
  Plan change: any task that runs Firefox or WebKit under Playwright 1.63.0
  (CI and local) installs those browsers first (`playwright install`), or
  is scoped to Chromium; nothing in the cache can be assumed.

S3 (search, locales). verified: `@easyops-cn/docusaurus-search-local` 0.55.3
(`hashed: true`, `language: ['en','fr']`, `docsRouteBasePath: '/'`) builds
`search-index.json` at each locale root: 4,083,051 bytes (1,078,684 gzip) for
`en` and 4,096,324 (1,080,593) for `fr`, over the three documents split as one
page each. The `fr` index repeats the untranslated English pages, so the two
languages cost twice. `hashed: true` left the filename unhashed. No external
request in the walk; 18-suggestion check not repeated. `/search/` is excluded
from both sitemaps with `ignorePatterns: ['**/search/**']` and emits
`robots: noindex, follow` itself. Pressing Enter in the search box on
`/guide/` left the URL at `/guide/` (the walk in S5); the results page works
at `/search/?q=…`. `i18n/fr/docusaurus-plugin-content-docs/current/intro.md`
builds `/fr/intro` with `<html lang=fr>`, `og:locale` `fr` with `en` alternate,
`hreflang` en, fr and x-default on both languages' pages, its own search index;
the untranslated pages appear in English under `/fr/` and are in the `fr`
sitemap. `static/robots.txt` and `static/img/favicon.svg` reach the site root
and are also copied under `/fr/` (crawlers read only the root one).
verified: `curl -H 'Accept-Language: fr' http://localhost:4302/` against
`docusaurus serve`: `200`, `lang=en`, no `Location`; Docusaurus does not
redirect on the browser's language. The same is expected of GitHub Pages, which
serves files: assumption. ADR 0043 row 8 is reworded to this layout by the task
that owns the ADR.

S4 (two bases, one source). verified: `DOCS_BASE=/odudu/ docusaurus build
--out-dir dist-pages` and `DOCS_TARGET=image docusaurus build --out-dir
dist-image`, alternated twice on the persistent cache (5.5 s and 5.2 s each
with two locales and the three documents), and once more with `docusaurus
clear` between: every absolute `href`/`src` on `<a>`, `<link>`, `<script>` and
`<img>` (325 per output, parsed, not grepped) starts with its own base, and the
`baseUrl:"…"` literal in `main.*.js` matches (`/odudu/`, `/docs/`). 10 MB on
disk each. A root-relative Markdown link `/request-paths/` becomes
`/odudu/request-paths` and `/docs/request-paths`; a Markdown link to `/nope/` is reported
as `/odudu/nope/` under `onBrokenLinks: throw`. The unresolved relative
`.md` links from the moved documents are the only absolute hrefs outside the
base (`/README.md`): they escape the base, which is the same defect as above. In
the image build the pages plugin reads `src/image-pages`, `index.html` is the
plain home (`Documentation home`) and no output file contains the landing's
text.

S5 (inline scripts and styles). verified: cheerio over every HTML file of the
two-locale, searchable build (18 pages): no `<style>` element; exactly one
executable inline `<script>` per page, but **two distinct bodies, one per
locale**, because the stored-theme key differs; 10 distinct `style=` values
(9 in the image build, 16 pages). `baseUrlIssueBanner: false` kept. Plan change
for the CSP task: the hash set holds one script hash per configured locale, and
the test recomputes them from the HTML as already planned. verified: a
Chromium walk at 390 px (landing, mobile menu, theme toggle in it, `/intro/`
code-copy, `/guide/` search typing and Enter, `/fr/intro/`, `/search/?q=`)
served by `scripts/serve.mjs`-style server under `default-src 'self';
script-src 'self' <2 hashes> 'report-sample'; style-src 'self';
style-src-attr 'unsafe-hashes' <10 hashes> 'report-sample'; img-src 'self'
data:; connect-src 'self'` reported **zero** violations and no request to
another origin; the control with `style-src-attr 'report-sample'` alone
reported 24 (inline `display: none` and the like). **The policy as the plan
words it lacks `img-src 'self' data:`**: Infima's chevron, menu and
copy-button icons are `data:image/svg+xml` backgrounds, and without it the walk
reports `img-src data` violations (27 before, 0 after). Add it to the policy.
assumption: the inventory is stable across pages and releases of 3.10.2;
Task 20's test recomputes it.

S14 (metadata, sitemap, Lighthouse, agent copies).

- (a) verified: `canonical`, `og:url`, `og:locale`, `hreflang` and the
  `BreadcrumbList` JSON-LD are absolute from `url` + `baseUrl`
  (`https://example.github.io/odudu/…` form checked with `DOCS_BASE`).
  `BreadcrumbList` appears on `request-paths` and not on the slug-`/intro` page,
  so a test must not require it on every page. Under `DOCS_TARGET=image` the
  `noindex` tag from `headTags` is present on every page and an
  about 25-line `postBuild` plugin leaves 0 canonical, 0 `hreflang`, 0 `og:url`, 0 JSON-LD
  (as an inline plugin in the config; it returns a plugin function).
- (b) verified: the landing's JSON-LD through `@docusaurus/Head` arrives intact
  in `build/index.html`.
- (c) verified: `sitemap.xml` is absolute and per locale (7 URLs; the `fr` one
  lists only `/fr/…`), without `/search/`.
- (d) verified: `lhci healthcheck` and `lhci collect && lhci assert` with
  `CHROME_PATH` set to Playwright's Chrome for Testing (macOS arm64): collect
  and assert pass 12 runs. assumption: `ubuntu-latest` finds Chrome without
  `CHROME_PATH`; not run, because no branch was pushed.
- (e) verified: `docusaurus serve` is uncompressed
  (`accept-encoding: gzip` returns no `content-encoding`) and listens on
  `localhost` only (a `127.0.0.1` request hangs). `lhci collect`, 3 runs,
  median, mobile profile: `serve` performance 0.76, LCP 4,277 ms, TBT 24 ms; a
  ~25-line gzip static server (`serve.mjs`, 404 outside the base): landing 0.98,
  LCP 2,255 ms; `/intro/` 0.99, 2,083 ms; unsplit `/console-paths/` 0.97,
  2,234 ms, TBT 134 ms; `/fr/intro/` 0.99, 2,082 ms. assumption: GitHub Pages
  compresses text responses; the first deploy's `curl -sI -H 'accept-encoding:
gzip'` settles it.
- (f) verified: accessibility, best-practices and SEO 1.00 on all four URLs,
  CLS 0, with `--ifm-link-decoration: underline` and `prism` themes `github`
  and `dracula`; `favicon: 'img/favicon.svg'` gives no 404. `static/robots.txt`
  makes `docusaurus serve` answer `/robots.txt` with the file (the scratch run
  saw HTML because none existed).
- (g) verified: `docusaurus-plugin-llms` 0.6.1 (`docsDir: 'content/en'`) writes
  `llms.txt`, `llms-full.txt` and one `.md` per page, including under `/fr/`;
  links are `https://example.github.io/odudu/intro.md` under a base and
  `/docs/intro.md` for the image (`useRelativeUrls`). An `.mdx` page's copy is
  not rendered: the `import` line stays and `{1 + 1}` is left as text.
  **The `.md` copies keep body links untouched**: `/request-paths/` is not
  base-prefixed in `intro.md` under `/odudu/`, and `llms-full.txt` keeps
  `../README.md` and `request-paths#…` as written. Plan change: agent copies
  are only as correct as the source's links, so the base-prefix and the
  absolute-URL rewrites belong to the content, not to the plugin.

### The stack and the pages: spikes

2026-10-19. Docker 29.8.2, Compose v5.6.0, the current `infra/docker/Dockerfile`
built as `odudu:spike`, Postgres 17-alpine, host port 3220, no Postgres port
published, project `odudu-spike`, removed with `down -v` (no stack of the
`odudu-try` project was touched). Each line is a command that was run unless
marked `assumption:`.

**S6, the one-file compose.** Two scratch files, `postgres` + `setup` +
`odudu`, differing only in how the roles appear.

- (a) verified: `configs: roles: content: |` with the role SQL, mounted on
  `postgres` at `/docker-entrypoint-initdb.d/01-roles.sql`, creates the file in
  the service (`docker compose exec postgres cat …`) and Postgres runs it:
  `\du` lists `odudu_app` and `odudu_svc`, `/health/ready` answers 200.
  Roles through the owner connection instead (a one-shot `roles` service,
  `psql postgres://odudu:…@postgres/odudu` with an `IF NOT EXISTS` `DO` block
  and `GRANT odudu_app TO odudu_svc`, `odudu` depending on it with
  `service_completed_successfully`) also boots the server, and re-running it is
  harmless (`NOTICE … already been granted`). Which is simpler: the `configs:`
  form is four lines on `postgres` and nothing to order, but it runs only when
  Postgres initialises an empty data directory, so it cannot serve a database
  that already exists and changing the password later does nothing; the owner
  route is a separate step of about fifteen lines in compose, and zero lines
  once `odudu init` does it through the same owner connection the server
  already uses for migrations. The `odudu` image has no `psql` and the `postgres`
  driver is bundled, not installed, so the compose form of the owner route needs
  a Postgres image to run `psql` in; only a command inside the server bundle
  avoids it. Plan change: ship the `configs:` form in the one-file compose, and
  make `init` the owner-connection path that also serves an existing database.
- (b) verified: `command: ["node","--env-file=/var/lib/odudu/quickstart.env",
"dist/main.js"]` reads a file another service wrote into a shared named
  volume, and `depends_on: setup: condition: service_completed_successfully`
  held `odudu` back until `setup` exited 0 (`ps -a`: `setup exited 0`,
  `odudu running`, `curl /health/ready` 200); `restart odudu` keeps working
  from the same volume. **Two defects the first attempt hit, both of which go
  into the plan:**
  - **A named volume on a path the image does not have is root-owned**, so the
    `odudu` user (uid 100) cannot write the file: `can't create
/var/lib/odudu/quickstart.env: Permission denied`. The runtime stage needs
    `mkdir /var/lib/odudu && chown odudu:odudu /var/lib/odudu` before
    `USER odudu`, because a new volume copies the ownership of an existing image
    path. verified: a derived image doing exactly that, rebuilt `up`, and the file
    was written.
  - **A failed redirect did not fail the `setup` service.** `sh -c` with
    `set -eu` and `{ … } > "$f"` printed the error and the script still ended
    on a successful command, so `setup` exited 0 with no file and `odudu` then
    died with `node: /var/lib/odudu/quickstart.env: not found`.
    `service_completed_successfully` only asserts the exit code, so the
    command that writes the file is a real subcommand that exits non-zero when
    it cannot, or ends with `test -s`.
- `odudu console keygen` already prints the whole line
  `ODUDU_CONSOLE_CLIENT_KEY=<base64>`; appending it as is works, prefixing it
  again produced `the key is not base64-encoded JSON` and a boot failure. The
  image's `node:24-alpine` is Node 24.21.0 (this host is 24.15.0) and prints
  two `ExperimentalWarning`s to stderr for the Web Crypto call; `NODE_NO_WARNINGS=1`
  silenced them.
- (c) verified: inside `setup`, `[ -t 0 ]` is false under `docker compose up`
  (also under `script`, so a pseudo-terminal on the caller does not give a
  service one), false under `docker compose run --rm setup` when the caller's
  stdin is not a terminal (even without `-T`), and true under
  `script -q /dev/null docker compose run --rm setup`. A human's terminal
  gives the same as `script`'s pseudo-terminal: assumption (not run in an
  interactive session here). So a prompt in `setup` is reachable only through
  `run` from a terminal, and `up` has to take every value from the
  environment.
- (d) verified on macOS (BSD `script`, Darwin arm64): `script -q /dev/null
docker compose run --rm setup` gives `tty=yes`. **The form is not portable**:
  util-linux `script` on ubuntu-latest takes the command as
  `script -q -e -c "docker compose run --rm setup" /dev/null`, and the BSD
  form there would start a shell. assumption: that ubuntu form, not run; a
  throwaway-branch run settles it, and the plan's CI step must name it, not
  the macOS one.
- (e) verified: `docker compose config` with `ODUDU_PORT` unset shows
  `published: "3000"` and `ODUDU_PUBLIC_BASE_URL: http://localhost:3000`; with
  `ODUDU_PORT=3220` both read 3220. The one variable feeds the mapping and the
  public URL; `ps` shows `5432/tcp` only for `postgres` (nothing published).

**S7, the Instrument stylesheet under the page policy.** `tokens.css` and
`fonts.css` concatenated (fonts rewritten from the `@fontsource` package paths
to `/instrument/fonts/<file>`), served from a throwaway Fastify route, linked
from the existing `renderLoginForm` page under `default-src 'none'; style-src
'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none';
frame-ancestors 'none'`.

- verified: Chromium (Playwright 1.63.0), light and dark: zero
  `securitypolicyviolation` events and zero console CSP messages; the
  stylesheet and `ibm-plex-sans-latin-400-normal.woff2` return 200 and
  `document.fonts.check('400 16px "IBM Plex Sans"')` is true.
- verified: `light-dark()` follows `prefers-color-scheme` through
  `--surface-page` (`rgb(231, 234, 233)` light, `rgb(21, 26, 25)` dark) and
  `--ink-primary`.
- verified: size. The stylesheet is 7,679 bytes plain and 1,581 gzip against a
  12 KB / 64 KB budget; it declares 12 `@font-face` rules (Sans and Mono, latin
  and latin-ext at 400, 500, 600) and a page that uses only the latin 400 face
  downloads one file, because `unicode-range` makes the others lazy. The
  twelve woff2 files total 206,232 bytes but are never loaded together. So no
  `latin-ext` face has to be dropped, and `font-display: swap` is already in
  `fonts.css`.
- Not covered: the base styles a real stylesheet adds (the spike appended one
  rule that uses the tokens, because the login markup has no styles of its
  own); the budget has to be re-read with them.

**S8, ICU in the bundle.** `intl-messageformat` 12.1.3 in a scratch tsup
project with `apps/server/tsup.config.ts`'s `noExternal`/`external` shape
(copied), `import en from './en.json' with { type: 'json' }`.

- verified: `npx tsup` builds `dist/main.js` (67.11 KB) in 8 ms; `node
dist/main.js` under Node 24.15.0 prints `Hello`, then `2 seconds` and
  `1 second` for the plural message; the JSON is inlined (it runs with no
  `en.json` beside it) and the bundle has no `require(` of a missing file.
- verified: `ar` with all six categories returns the right branch for
  `n` = 0 (zero), 1 (one), 2 (two), 3 (few), 11 (many), 100 (other), from
  `Intl.PluralRules`, so no locale data is bundled.
- verified: size for the console. esbuild, `--bundle --minify --platform=browser
--target=es2023`, a module that only constructs and formats an
  `IntlMessageFormat`: 33,533 bytes, **9,900 bytes gzip** (9,818 at `-9`).
  Against `tests/lint/console-phone-chunk.test.ts`: the entry is budgeted
  153,000 B on a measured 145,018 B (headroom 7,982 B) and the first load
  242,000 B on 229,800 B (headroom 12,200 B). The formatter alone is over the
  entry's headroom and inside the first-load's. Decision for P4h, which owns
  the console: either raise the entry budget by about 10 KB (6.8 per cent) with
  the reason beside it, as the file's own comment requires, or keep ICU out of
  the entry (a plural-only formatter, or a lazy chunk loaded with the first
  non-English catalogue). The server side has no such constraint: the 67 KB
  bundle above is the whole cost.

### Base images by digest

2026-10-19. Every `FROM` and `image:` under `infra/` carries `tag@sha256:`, the
index digest, so one pin serves both architectures;
`tests/lint/base-images-pinned.test.ts` keeps it so for `infra`, `examples`
and `quickstart`.

- verified: `docker buildx imagetools inspect <image> | sed -n 's/^Digest: *//p'`
  for `node:24-alpine`, `postgres:17-alpine`, `axllent/mailpit:v1.31.5`,
  `swaggerapi/swagger-ui:v5.33.0`, `nginx:1.27-alpine` and `mongo:6.0.13` gave
  the digests now in the files; the first four match the plan's values.
- The plan listed five images; the sweep found two more. `mongo:6.0.13`
  (`infra/conformance/suite-compose.yaml`) and a second `postgres:17-alpine`
  (`infra/conformance/compose.yaml`) were unpinned. The echo image in
  `compose.try.yaml` was pinned by digest alone, which Dependabot cannot read:
  verified: the Docker Hub tags API lists `42` and `latest` at that digest, so
  it is now `mendhak/http-https-echo:42@sha256:a265f5...`.
- verified: `docker build -f infra/docker/Dockerfile -t odudu:p4g-pin .` exits 0
  and `./infra/docker/smoke.sh` ends with `smoke: the console shell is
served from the image` (the asset it names is content-hashed).
- `.github/dependabot.yml` gains `docker` (`/infra/docker`,
  `/infra/conformance/proxy`) and `docker-compose` (`/infra/docker`,
  `/infra/conformance`) in one `base-images` group each, using `directories`;
  `/quickstart` joins with its compose file.

### `odudu` as a command in the image

- `/usr/local/bin/odudu` is a two-line shim over `node /app/dist/main.js`;
  `CMD` is unchanged and no `ENTRYPOINT` is added, so the node base image's
  `docker-entrypoint.sh` still wraps both.
- `ARG`/`ENV ODUDU_VERSION` (default `dev`) and the OCI `source`, `licenses`
  and `version` labels are set in the runtime stage. Built with
  `--build-arg ODUDU_VERSION=1.2.3`, `docker inspect` showed the labels and
  `echo $ODUDU_VERSION` printed `1.2.3`.
- `smoke.sh` runs `docker compose exec -T odudu odudu reap` and requires a
  JSON report; before the shim it failed at that line, after it passes.
- verified: Dependabot's compose fetcher selects files with the unanchored
  `/(docker-)?compose(-[\w]+)?(?>\.[\w-]+)?\.ya?ml/i`
  (`gh api repos/dependabot/dependabot-core/contents/docker/lib/dependabot/docker_compose/file_fetcher.rb`),
  so `suite-compose.yaml` matches on its `compose.yaml` suffix and needs no
  rename. verified: `gh api repos/dependabot/dependabot-core/contents/docker/lib/dependabot/docker/file_fetcher.rb -q .content | base64 -d | grep DOCKER_REGEXP`
  gives `DOCKER_REGEXP = /dockerfile|containerfile/i`, so the docker fetcher
  takes any name containing either word.
- The image gains `ARG ODUDU_REVISION` and the `revision` label; `compose.yaml`
  passes `${ODUDU_REVISION:-unknown}`. The `container` job sets it on its
  smoke step, and `.github/actions/image` passes it as a build arg to both jobs, both
  as `github.sha`. `smoke.sh` asserts the label. The conformance rig's own
  build is not a distributed image and is left unlabelled.
- `base-images-pinned.test.ts` now also reads `.github/**/*.{yml,yaml}`
  (`image:`, scalar `container:`, `docker://`), Dockerfile continuations,
  `Dockerfile.*` names, `COPY --from` and `RUN --mount from=`, and
  Testcontainers constructor literals, which are now pinned.

## odudu init

- verified: `node_modules/.bin/vitest run --project integration apps/server/src/cli/init.int.test.ts`:
  `CREATE ROLE ... PASSWORD $1` is refused by Postgres (utility statements take
  no bind parameters), so `init` has the server build the statement with
  `select format('CREATE ROLE odudu_svc LOGIN PASSWORD %L', $1::text)`, the
  password bound to `format()`, and runs the returned text.
- `init` refuses an existing `odudu_svc` role when `quickstart.env` is absent:
  the role's password is unknown and resetting it would break whatever uses it.
- A password comes from `ODUDU_ADMIN_PASSWORD`, else the terminal prompt when
  stdin is a terminal, else it is generated (see the quickstart compose file).
- `init` creates `odudu_svc` from a SCRAM-SHA-256 verifier computed with
  `node:crypto` (no dependency), so the plaintext never reaches
  `log_statement=ddl` or `pg_stat_statements`. verified: the integration test
  signs in as the service role through `quickstart.env`'s URL.
- Runs are serialised by `pg_advisory_lock(hashtext('odudu_init'), 0)` held on
  the owner connection, and `quickstart.env` is published by link from a
  mode-0600 temp file; verified by the two-concurrent-runs test.

## The quickstart compose file

- verified: `docker compose -f quickstart/compose.yaml up -d` with a locally
  built image (`ODUDU_PORT=3250`): `setup` exited 0 after printing the banner
  once, `odudu` was healthy, `/health/ready` answered, `/console/` answered 200,
  `ps` showed `5432/tcp` only for `postgres`, and a second `up -d` ran `setup`
  again to "already exists" with the server unharmed.
- **`stdin_open: true` with `tty: true` on `setup` makes `up` interactive.**
  Stdin is then a pseudo-terminal under `up -d` (`ls -l /proc/1/fd` shows
  `/dev/pts/0`), so `init` waited for a password nobody could type and `odudu`
  never started. Contradicts the spike line above that a prompt is reachable
  only through `run`; the compose file sets neither key, and `docker compose
run --rm setup` allocates the terminal itself. verified: `script -q
/dev/null docker compose run --rm setup` on macOS prompted for the password
  twice, refused a short one with the policy message, echoed nothing typed,
  and printed the banner without a password.
- The roles are created by `init`, not by a `configs:` script on `postgres`: a
  role created that way would make `init` refuse (`odudu_svc` exists, no
  `quickstart.env`).
- The image gains `/var/lib/odudu`, `0700`, owned by `odudu`; a named volume
  copies both. verified: `init` wrote `quickstart.env` into the fresh volume.
- `ODUDU_ADMIN_EMAIL` is read by `init` when no `--admin-email` is given.
- `base-images-pinned.test.ts` exempts the one interpolation
  `${ODUDU_IMAGE:-ghcr.io/wizzywit/odudu:<tag>}`, the project's own image.

### One command, qualified

The design's goal of one command from nothing to a signed-in console is met
as: `docker compose up -d` with no input (administrator `admin@odudu.local`,
generated password, printed once in `docker compose logs setup`), and, for a
prompt, `docker compose run --rm setup` followed by `docker compose up -d`.
Compose gives a service no terminal under `up`, so the prompt cannot belong to
the first command. verified: both sequences on a local image, sign-in with the
printed password reached the change-password page, and a later `up -d` ran
`setup` to "already exists" with exit 0. A defaulted address never conflicts
with an existing administrator; one named with `--admin-email` still does.
The compose file's image tag is the placeholder `0.0.0`, replaced by the
release when the file is published as a release asset; the lint accepts only a
semver tag there.

### NODE_ENV in the quickstart

- verified: `grep -rn "NODE_ENV" apps packages` (sources, no tests): the server
  reads `config.NODE_ENV` only in `apps/server/src/config-guard.ts`. Under
  `production` it refuses to boot without `ODUDU_APP_DATABASE_URL`, with the
  published example KEK, without `ODUDU_TLS=true`, with
  `ODUDU_ALLOW_PRIVATE_CLIENT_URLS`, and without `ODUDU_PUBLIC_BASE_URL`.
  Cookie `Secure` and the `__Host-` prefix follow `ODUDU_TLS` and the base
  URL's scheme, not `NODE_ENV`; error detail and logging do not read it.
- The quickstart sets `NODE_ENV=development` for one reason, the TLS guard: it
  is plain http on loopback. The other four guards are met or unused (the app
  URL is set, the KEK is generated, private client URLs are off, the base URL
  is set). `infra/docker/compose.yaml` sets the same value for the same reason.
  `quickstart-compose.test.ts` pins the value, the "not a production
  deployment" comment and that the file sets none of `ODUDU_TLS`,
  `ODUDU_ALLOW_PRIVATE_CLIENT_URLS`, `ODUDU_KEK`.
- With `ODUDU_ADMIN_PASSWORD` set and no email on a terminal, `init` defaults
  the address instead of asking (`init.int.test.ts`; README states it).

### The shell and the reach check

- verified: `node_modules/.bin/vitest run --project unit packages/protocol-oidc/src/view/instrument-reach.test.ts`
  before the change: four renderers built a document of their own and
  imported no shell, `passkey-enrolment-html.ts`, `recovery-codes-html.ts` and
  `update-password-html.ts` in authn-flows (each with its own `escapeHtml`) and
  console-gateway's `refusal-html.ts`; `update-password-html.ts` had no test.
  All four now call their package's `page()`; its test was added with the
  check so the check ends green.
- The shell is one `page(title, body, script, frames, locale)` in each of four
  packages, held to one text by the reach test (comments aside). `body` is the
  renderer's content only; the shell owns `<main class="page">`, the mark, the
  stylesheet and favicon links. `PageLocale` is a local structural type until
  the i18n package exists.
- `x-content-type-options: nosniff` is sent by `pageHeaders`, the console shell
  and `/console/assets/*`, and `/instrument/*`; the Instrument routes bound
  their tree at 128 entries (`maxEntries`).
- A recorded `content-security-policy` block is now also held to the other
  headers `pageHeaders` sends, to the nonce form, to `connect-src 'self'` as
  the only directive beside a script, and to `frame-src` as bare origins.
- axe in the browser covers the sign-in form, the throttle page and the
  console's sign-in states only. The other page kinds (consent,
  select-account, logout, registration, verification, reset, required-action,
  TOTP, passkey, recovery codes, update-password, the error pages) are
  unit-tested but not run under axe. That belongs to P4b's every-page criterion
  (design spec section 11, P4b row: "every such page passes WCAG 2.2 AA under
  axe in both colour schemes"), which already names it, so nothing is added to
  a list.
- Recorded page documents are held to their bytes and to `page()` by
  `tests/docs/page-documents-transcripts.test.ts`; a block showing part of a
  document says so with a `…` line in it. Fix round: the console refusal
  transcripts at the `/console/auth/callback` section were stale and are
  recaptured (a first refusal restarts, a second inside the minute answers the
  page).

## Increment 13b: ui_locales parked, negotiated per page, discovery

- `ui_locales` is parked as `uiLocales` in `pending_request`, a jsonb column,
  so no migration (nothing touches a large table) and the restart link rebuilds
  it beside `prompt` and `max_age`. Parked tags are only those matching
  `[A-Za-z0-9-]{1,35}`, at most sixteen, deduplicated; the strict `isValidLocale`
  shape and the lookup are `negotiateLocale`'s. A tag outside the shipped list
  never reaches `<html lang>` or `Content-Language`: output is always an entry
  of the supported list.
- The language is negotiated before a renderer runs. `negotiatePageLocale`
  (`@odudu/i18n`, every input optional, never throws) is the one helper. Every
  `render*` takes a trailing `locale` and hands it to its package's `page()`,
  which writes `<html lang dir>`; `Content-Language` is `page.locale.tag`.
  `tests/lint/page-routes-negotiate-locale.test.ts` fails on a route call to a
  renderer that does not end with a locale. Pages with a parked request
  negotiate through `continuation()` (`ui_locales`, then the subject's `locale`,
  then `Accept-Language`); every other page (authorize error, logout, throttle,
  account pages, console refusal) negotiates on `Accept-Language` alone.
- ADR 0043 step 2: `users.locale` exists, and `continuation()` reads it
  through `subjectLocale` once a subject is known: required-action pages
  (first factor verified) pass their subject, consent after login and the
  reuse path pass `'authenticated'`. The login form, the account chooser and
  the refusal page never pass a subject. A required-action page re-rendered
  before the flow is finished falls back to `ui_locales`/`Accept-Language`,
  since the session reports no finished authentication yet.
- ADR 0043 step 3: the tenant default is `null` everywhere. P4b's row names
  it ("a tenant's supported-locales list, default locale and per-locale
  message overrides"); the helper already accepts `tenantDefault`.
- `SHIPPED_LOCALES` (`@odudu/i18n`) feeds negotiation and discovery.
  `tests/lint/shipped-locales.test.ts` finds every module that calls
  `createCatalogue`, requires its exports' `locales` to include `en` and to be
  within `SHIPPED_LOCALES`, and requires every shipped tag to be held once any
  catalogue exists, so increment 14 only has to export its catalogue.
- `createCatalogue` refuses a message containing a tag (`<b>`), `Accept-Language`
  keeps an entry whose parameter is not `q`, `parseUiLocales` reads lazily.
- `execute-actions.int.test.ts` asserted the page carried no `href`, which the
  Instrument shell's stylesheet link broke; it now asserts no anchor.
- `content-language: en` was added to every recorded page header block in the
  three guides (22), and `ui_locales_supported` to the discovery transcripts.
- Fix round 2: every renderer's `locale` is required (a forgotten argument no
  longer compiles; the lint still checks provenance); `subjectLocale` has an
  integration test (`ui-locales-subject.int.test.ts`) with a foreign-tenant
  probe; `pageHeaders` also refuses a `dir` outside `ltr`/`rtl`. Left as is:
  `required-action-response.ts` resolves the authenticated subject itself for
  the recovery-codes gate and `continuation()` takes the subject it is handed,
  so no page asks twice for the same thing today; fold them if increments 14 to
  16 add a per-page lookup.

## Increment 14: protocol-oidc page text in a catalogue

- The catalogue is `packages/protocol-oidc/src/view/messages.ts` (a flat record
  `en`, built with `createCatalogue`), not `catalogue/en.json` as the plan said:
  the text is TypeScript so a renderer's `t` id is checked by `tsc`. `t` is
  plain text (a title the shell escapes, a test); `tHtml` is escaped markup, and
  the values it is given in `isolated` are wrapped in `<bdi>` after `escapeHtml`.
  A user value reaches a message only as a marker the escaped result is searched
  for, so the message is escaped once and each user value once.
- A French catalogue exists in tests only (`withFrench`, `FRENCH` and `ARABIC` in
  `@odudu/testkit/i18n`, shared by every package): a renderer test mocks `#/view/messages`
  with `withFrench`, so the real renderer is the one rendering French.
  `SHIPPED_LOCALES` stays `en`.
- The English text is byte-identical to before except three things, each one
  re-recorded in `apps/docs/content/en/reference/transcripts/request-paths/`: user-controlled values sit in
  `<bdi>`, an apostrophe in a page's own text is `&#39;` (the catalogue is
  escaped as a whole, not trusted), and the passkey script reads its three
  sentences from `data-` attributes of its form (`data-failed` carries
  `{reason}`, which the script replaces with the browser's own reason).
  The redirect-refused logout sentence lost a hard line break. A plural uses
  ICU, so `Try again in 1,000 seconds` would now carry a thousands separator.
- The login refusal constants are catalogue ids; `refusalMessage` returns an id
  and the page formats it. The page is still no oracle: one id per step.
- Literals that stay: the protocol `error_description` an authorization error
  passes through (`outcome.description`) and the `415` media-type sentence are
  developer-facing under ADR 0043 and are isolated in `<bdi>`, not translated;
  the `·` between a client's links; the `<small>` error code; a value attribute
  that echoes the username (an attribute is its own isolation).
- Password-policy sentences: the kernel's `PASSWORD_TOO_LONG.message` and the
  rule messages in `packages/domain-identity/src/service/password-policy.ts`
  (lines 55 to 110) stay developer-facing English, because domain packages hold
  no catalogue. Every **view** that shows one to a person maps the rule code to
  a catalogue id of its own package, with the limit as an ICU argument
  (`error.passwordTooLong` takes `{max}`). protocol-oidc does it now
  (`routes/login.ts`, `routes/required-action.ts`); the other sites are named in
  the plan under Tasks 15, 16 and 17c.
- The passkey script swaps `{reason}` with a replacer function, so a browser
  reason holding `$&` is not interpreted; `throttled.retryAfter` formats with
  `::group-off`, so 3600 seconds reads `3600`, as before. The
  `page-documents-transcripts` test now renders each recorded consent, chooser,
  error, logout and throttle body back through the real renderer.

## Increment 15: authn-flows page text in a catalogue

- The helpers that read a catalogue (`t`, `tHtml`, `bdi`, the marker that keeps
  a user value out of the ICU string) moved from protocol-oidc to
  `createTranslators` in `@odudu/i18n`, which takes the calling package's own
  `escapeHtml`: authn-flows cannot import protocol-oidc, and account and
  console-gateway need the same thing next. Each package still has its own
  `messages.ts` holding its `en` record and exporting `catalogue`;
  `tests/lint/shipped-locales.test.ts` now finds a catalogue built by
  `createTranslators` as well as `createCatalogue`.
- Violations of the password policy are `{ rule, message, minLength? }`
  (`schema/password-violation.ts`): `rule` is the domain's code and picks the
  catalogue entry, `message` is the developer sentence shown (isolated) only for
  a rule this build has no entry for, `minLength` is the number the minimum
  sentence states. The superseded-password sentence is the `superseded` rule
  (`SUPERSEDED_PASSWORD`), so one page lists every sentence it can show.
  `PASSWORD_TOO_LONG` is passed as it is and read by its code (`max-length`).
- The reason a required-action page is shown again is a code
  (`EnrolmentRefusal`: `code_mismatch`, `codes_not_saved`, `passkey_not_added`),
  not a sentence, so protocol-oidc's usecase holds no English any more.
- Secrets and codes (key URI, key, recovery codes) print inside
  `<bdi dir="ltr"><code>`; the hidden `secret` field and every escaping are as
  they were. The passkey page's script reads its two sentences from
  `data-failed` and `data-cancelled` on its form, as the sign-in script does.
- `update-password-html.test.ts` already existed; it now asserts the action
  the form posts to, the title, `<bdi>` for an unknown rule, escaping, and every
  rule in a French fixture.
- The English markup is byte-identical except `<bdi dir="ltr">` around the three
  token kinds and the two `data-` attributes on the passkey form; an apostrophe
  in a page's own text would be `&#39;`, and none of these pages has one.
- The passkey sign-in script (protocol-oidc) and the passkey enrolment script
  (authn-flows) each hold the `{reason}` placeholder and the
  `form.dataset.failed.replace(...)` line. Two packages cannot share a script
  string without a package both may import and that owns markup, which does not
  exist (`kernel` is transport-free, `i18n` holds no markup); each is pinned by
  its own `vm` test.
- The French fixture helpers (`withFrench`, `FRENCH`, `ARABIC`) are in
  `@odudu/testkit/i18n`; `tests/lint/shared-fr-catalogue.test.ts` fails on a
  package that keeps a copy.

## Increment 16: account and console-gateway page text in a catalogue

- Fifteen account renderers (registration 3, verification 2, reset 8, required
  actions 2) and the console-gateway refusal page now read their text from
  `packages/account/src/view/messages.ts` (60 entries) and
  `packages/console-gateway/src/view/messages.ts` (3). Entries per package so
  far, counted with `Object.keys(en).length`: protocol-oidc 57, authn-flows 39,
  account 60, console-gateway 3: 159, before mail templates. Catalogues are TS,
  as in increments 14 and 15, not `catalogue/en.json`.
- Account routes no longer pass sentences to a page. A refusal is a code
  (`RegistrationRefusal`, `ResetRequestRefusal`) and a password rule is a
  `PasswordViolation` read by its code, the same mapping authn-flows has; the
  account views keep their own copy of the rule list (`password-rules.ts`)
  because a view may not import another package's internals. `register`,
  `completePasswordReset` and `completeRequiredActions` add `minLength` to the
  minimum-length violation (`service/password-violations.ts`);
  `PASSWORD_TOO_LONG` is passed as it is and read by its `max-length` code.
- An actions link's page lists actions by code, not by label: `peekActionToken`
  returns `actions` and `completeRequiredActions` returns `remaining` as
  `LinkedRequiredAction` codes, and the page words each from its catalogue. The
  mail still builds its list with `actionLabel`, which moves with the mail
  templates.
- `sendVerificationHtml` sends `content-language` through `pageHeaders`
  (tested against a real reply); the refusal page is tested through `sendPage`
  for the Instrument link and `Content-Language: en`.
- The registration form shows neither the tenant's display name nor an entered
  email, so there is nothing there to isolate; the tenant name appears only in
  the escaped form action.
- Reset-request enumeration: the response for a known and an unknown address is
  byte-identical, headers included, in `en`, `fr` and a negotiated mixed
  header (`reset-password.int.test.ts`).
- English markup differs only by `&#39;` for an apostrophe in a page's own text
  (`Can&#39;t create this account`, `we&#39;ve sent`, `This link can&#39;t be
used`); the required-actions, registration success and form pages are
  byte-identical. Recorded transcripts changed in 11 lines and were checked
  against a live run on the project `odudu-p4g-16`.
- `tests/docs/page-documents-transcripts.test.ts` now renders back the recorded
  account and refusal pages; `tests/docs/password-policy.test.ts` reads the
  recorded violation sentences from the real renderers instead of a regular
  expression over a route.
- Left inline in console-gateway, on purpose: the API problem-details strings in
  `view/problem.ts`, `view/api.ts`, `view/csrf-guard.ts`, `view/routes/proxy.ts`
  and `view/routes/logout.ts` (`'Unauthorized'`, `'Not Found'`, `STATUS_CODES[status]`,
  `refused as cross-site: ...`). They are RFC 9457 values for a program, not
  pages; the console words what a person reads from the problem's code. The
  server-literal lint (plan Task 17c) covers `*-html.ts` and the mail
  templates only, and its plan text now says so.
- The nine `password.rule.*` sentences exist in the account and authn-flows
  catalogues. They are pinned equal by `tests/lint/password-rule-wording.test.ts`
  rather than shared: each package's catalogue is flat and its own (ADR 0043),
  and no package both may import owns text.

## Increment 17: mail text in a catalogue, bidi controls refused in typed fields

- Mail: `packages/email/src/service/messages.ts` (15 entries, TS like the page
  catalogues; running total 174) and `templates.ts`. The mail locale is the
  recipient's `users.locale`, else the tenant default (none exists until P4b),
  else `en`, reduced to a shipped catalogue by `negotiateLocale` over
  `catalogue.locales`; an unknown or malformed tag is English. `locale` is passed
  by the self-service reset (`findByEmail`) and the admin account-email route;
  registration and the seed command have no locale to give.
- Required actions travel as codes (`action.<code>` ids); `actionLabel` is gone.
  An unknown code shows in an isolate. The link is never catalogued: a message
  names it `{link}` and the one anchor replaces a per-process token.
- Tenant name: `<bdi>` in HTML, U+2068/U+2069 in text (with bidi controls and line
  breaks stripped so it cannot close its isolate or start a line), and in the
  subject stripped of bidi controls and every C0/C1 control and U+2028/9.
- Bidi rule: the list is ADR 0043's nine code points (U+202A-202E, U+2066-2069).
  LRM, RLM and ALM are accepted because Persian and Arabic text uses them.
  Detection and the field rule live in `@odudu/contracts` (`bidi.ts`), not kernel:
  the console imports contracts and kernel carries node-only modules. Kernel adds
  `BidiControlError` and `refuseBidiControls`, the guard every repository applies.
- The admin API validates a body through `z.toJSONSchema`, which drops a `refine`,
  so the rule is a negative `regex` (a JSON Schema `pattern`); a refinement would
  have been silently unenforced there. Open-record bodies (client, tenant patch,
  settings, import) are checked in their usecases; every repository guards as a
  backstop and the problem handler answers a `BidiControlError` as a 400.
- `fieldErrorSchema` gains optional `code` (P4h generalises it to `code` and
  `params`); the first value is `bidi_control_refused`.
- Entry paths: admin subject create/patch/profile, tenant create/patch/settings/
  import (document names too), client create/patch, role and group create,
  scope create, dynamic registration, self-registration, `odudu seed` (user,
  bootstrap, profile, role, group, scope, tenant `--set display_name`, admin).
- Fields covered, on every one of those paths: username, the six name claims,
  tenant `display_name`, `client_id` (admin create and import), client `name`
  and `client_name`, role/group/client/scope `description`, scope `consent_text`
  (display text a person reads on a consent page or in a list).
- Deliberately not covered, each with its reason: email (ASCII by its CHECK),
  scope and tenant names (ASCII by their CHECKs), a dynamically registered
  client's `client_id` (generated by the server), `client_name#lang` variants
  (accepted and ignored, never stored; P4b's per-locale client metadata, ADR 0043
  row 3, applies the rule where it starts storing them), `client_uri`,
  `policy_uri`, `tos_uri` and redirect URIs (validated as URLs, shown only as
  link targets), SMTP host, username and from address and mapper and
  authenticator names (transport and registry identifiers no person reads as
  text), and SCIM (P7 builds inbound provisioning and applies the rule there).
  A confusable-character policy is P7's, per ADR 0043 row 7.
- One rule for a value a row already holds: a write that changes a value is
  refused whenever the new value holds a control; the stored value may be kept
  byte-identical, so it can be sent back with an unrelated edit and is never
  rewritten, but a legacy value cannot be edited while its control stays.
  Exporting a tenant that holds one and importing it elsewhere is refused at
  the import document schema, at the field's path (an import is a creation);
  the operator fixes the source or edits the export first. Creation is checked by the generated schema (so the
  admin API's JSON Schema enforces it); an amendment is checked by its usecase
  against the stored value, with every repository applying the same comparison
  as a backstop. The sign-in path never checks. The usecase checks stay because
  they answer a returned field outcome before any write or audit row, where the
  repository throws out of a half-done transaction; `bidi-usecases.int.test.ts`
  fails for each site if its check is deleted (mutation-checked for the role,
  group, scope, tenant, settings, subject, profile and client sites).
- `odudu seed` prints `error: <field> must not contain ...` and exits 1 for a
  refused value, with no stack.
- No Unicode normalisation form produces a control from another code point
  (checked over every code point in `bidi.test.ts`), so checking raw input is
  checking the normalised input.
- Mail transcripts were rewritten by transformation and checked against a live
  run on `odudu-p4g-17`; the admin API refusals come from the integration suite.

## Increment 17: the server literal lint

- `tests/lint/server-page-literals.test.ts` reads each `packages/*/src/view/*-html.ts`
  and `packages/email/src/service/templates.ts` as TypeScript. It reassembles text
  across concatenation and template spans, blanks `${...}` and tags, and reports
  prose in text nodes, `<script>` bodies, `alt`/`title`/`placeholder`/`aria-label`,
  the `value` of an `<input type="submit">` and a literal title passed to `page()`.
  It found nothing in the tree: every renderer was already extracted.
- Deviation from the plan text: `value` on a `<button>` is not reported. It is what
  the form submits (`value="allow"` on the consent buttons), not what the button
  says; the label is the content, which is checked as text.
- A string outside markup (a script string, a plain constant) counts only when it
  reads as a sentence or a capitalised word, since `'submit'` and `'text/html'`
  are code. Its header names that and the other things it cannot see.
- Second check: no call to `render*` or `send*Error*` in a page package's
  `*-html.ts` or `view/routes/*.ts` takes an argument holding a `.message`. It found
  one: `routes/required-action.ts` rebuilt the oversized-password violation as
  `{ rule, message: PASSWORD_TOO_LONG.message }`; it now passes the constant, as
  the account routes do, and the view maps the rule to its own catalogue entry.
- Out of scope by kind, not by allowlist: console-gateway and protocol-admin
  problem-details strings (RFC 9457 values for a program).

### Increment 17, fix round

- The lint derives its files instead of globbing `*-html.ts`: every non-test file
  under a `packages/*/src/view` (or `apps/*/src/view`) that is a `*-html.ts` or
  builds a tag, minus `messages.ts` catalogues, plus the mail templates. That
  brings in `account/view/password-rules.ts`, `authn-flows/view/refusal.ts` and
  the four `document.ts` shells; the shells' structural text and attribute names
  are not prose by the rule, so nothing is waived.
- The SMTP test mail is a mail a person receives, so it left
  `protocol-admin/src/usecase/smtp.ts` for `renderSmtpTest` in `@odudu/email`
  (`smtpTest.subject`, `smtpTest.text`, an optional locale, English today since the
  destination has no stored locale); it is in scope as part of the templates.
- Also reported now: sentences given to helper calls inside markup, `label`,
  `summary`, `aria-description`, `aria-roledescription`, `aria-valuetext`, text in
  `data-*`, unquoted attribute values and `<meta name="description">`.
- The leak check follows a local alias, a destructured `message` and a bracket
  access into a `render*` or `send*Error*` call. It does not report the deliberate
  fallback `bdi(violation.message)` in `authn-flows/view/update-password-html.ts`
  and `account/view/password-rules.ts`: a rule code with no catalogue entry shows
  the domain's sentence, isolated, rather than nothing.

## Server pages: the visual pass

Every server page took one card width (28rem, the same on every page and in every
state), the brand line, a heading, the tenant and client lines, and a visible alert
marker. Only `packages/instrument/src/pages.css` and the renderers changed; the
console's tokens and CSS did not. The stylesheet's line budget moved from 250 to 360
lines, with the byte and gzip budgets unchanged.

What was wrong: the card sized to its content (about 270px wide) and widened when an
error sentence was longer than the form; the error was a bold paragraph with no
marker; labels sat inside the focus ring; the form pages had no heading; consent's
checkbox labels broke into columns; the QR code stretched to the card; a card's last
paragraph doubled the bottom padding; a hidden passkey error showed.

Each gallery image is the page in four views: desktop light and dark (1440px,
cropped to the card) and phone light and dark (390px). Pages without the words
"renderer only" were reached on a stack by `apps/admin-console/e2e/server-pages.spec.ts`
(and `throttle-page.spec.ts`), which also holds each to axe in four theme combinations,
to the phone width and to one card width. The renderer-only ones are pinned by their
renderers' tests and by `tests/docs/page-documents-transcripts.test.ts`: the
required-actions link pages need an admin-issued link, the recovery-code form needs a
flow that includes it, and the unavailable-action page needs a deployment without a
passkey relying-party id. The 768px width was captured and looked at too; it is the
desktop layout.

- ![signin-empty](p4g-pages/signin-empty.webp) `signin-empty`: The sign-in form with a client, remember-me and the passkey option.
- ![signin-links](p4g-pages/signin-links.webp) `signin-links`: Sign-in on a tenant that serves registration and reset: the two links under the form.
- ![signin-error-echo](p4g-pages/signin-error-echo.webp) `signin-error-echo`: A refused sign-in: the alert, the username given back, focus on the password.
- ![signin-long-names](p4g-pages/signin-long-names.webp) `signin-long-names`: Sign-in with a very long client name, tenant name and username (renderer only).
- ![signin-rtl](p4g-pages/signin-rtl.webp) `signin-rtl`: Sign-in under a right-to-left locale (renderer only).
- ![throttle](p4g-pages/throttle.webp) `throttle`: The too-many-attempts page.
- ![second-factor-totp](p4g-pages/second-factor-totp.webp) `second-factor-totp`: The authentication-code form with the recovery-code field.
- ![second-factor-totp-error](p4g-pages/second-factor-totp-error.webp) `second-factor-totp-error`: The same form after a wrong code.
- ![second-factor-recovery](p4g-pages/second-factor-recovery.webp) `second-factor-recovery`: The recovery-code form after an already-used code (renderer only).
- ![totp-enrolment](p4g-pages/totp-enrolment.webp) `totp-enrolment`: Authenticator enrolment with the QR code, after a wrong code.
- ![recovery-codes](p4g-pages/recovery-codes.webp) `recovery-codes`: The one-time list of recovery codes.
- ![passkey-enrolment](p4g-pages/passkey-enrolment.webp) `passkey-enrolment`: Passkey enrolment.
- ![update-password](p4g-pages/update-password.webp) `update-password`: Forced password change.
- ![update-password-violations](p4g-pages/update-password-violations.webp) `update-password-violations`: Forced password change refused, with the broken rules.
- ![required-action-unavailable](p4g-pages/required-action-unavailable.webp) `required-action-unavailable`: A pending action this deployment cannot offer (renderer only).
- ![required-actions](p4g-pages/required-actions.webp) `required-actions`: An administrator's required-actions link page (renderer only).
- ![actions-done](p4g-pages/actions-done.webp) `actions-done`: Account updated, with the way back a mailed link carried (renderer only).
- ![actions-done-direct](p4g-pages/actions-done-direct.webp) `actions-done-direct`: Account updated for a link no request started: what to do, no link (renderer only).
- ![required-actions-done](p4g-pages/required-actions-done.webp) `required-actions-done`: The page after such a link, with actions left (renderer only).
- ![consent](p4g-pages/consent.webp) `consent`: Consent with default and optional scopes.
- ![consent-long-names](p4g-pages/consent-long-names.webp) `consent-long-names`: Consent with a long client name and long unbroken scope names.
- ![consent-rtl](p4g-pages/consent-rtl.webp) `consent-rtl`: Consent under a right-to-left locale (renderer only).
- ![select-account](p4g-pages/select-account.webp) `select-account`: The account chooser with a long account name (renderer only).
- ![logout-confirm](p4g-pages/logout-confirm.webp) `logout-confirm`: Sign-out confirmation.
- ![logout-done](p4g-pages/logout-done.webp) `logout-done`: Signed out, with a front-channel logout frame.
- ![logout-redirect-refused](p4g-pages/logout-redirect-refused.webp) `logout-redirect-refused`: Signed out, the requested return address not registered.
- ![logout-no-session](p4g-pages/logout-no-session.webp) `logout-no-session`: Sign-out with no session.
- ![logout-unauthenticated](p4g-pages/logout-unauthenticated.webp) `logout-unauthenticated`: Sign-out refused: the confirmation did not match the session.
- ![error](p4g-pages/error.webp) `error`: The authorization error page.
- ![error-long](p4g-pages/error-long.webp) `error-long`: The error page with a long description and a long way-on link (renderer only).
- ![email-unverified](p4g-pages/email-unverified.webp) `email-unverified`: Sign-in refused until the address is verified.
- ![registration](p4g-pages/registration.webp) `registration`: The registration form.
- ![registration-required](p4g-pages/registration-required.webp) `registration-required`: Registration with nothing filled in: each empty field named, the first focused.
- ![registration-weak](p4g-pages/registration-weak.webp) `registration-weak`: Registration refused for the password's rules, in place, the other values kept.
- ![registration-taken](p4g-pages/registration-taken.webp) `registration-taken`: A username already taken, on its own field.
- ![registration-succeeded](p4g-pages/registration-succeeded.webp) `registration-succeeded`: Check your email, the page for a free and a held address alike.
- ![registration-mismatch](p4g-pages/registration-mismatch.webp) `registration-mismatch`: The two passwords differ: the alert, the confirmation focused, neither value given back.
- ![confirm-register](p4g-pages/confirm-register.webp) `confirm-register`: The page a registration link opens: the account name and one button, and nothing is created until it is pressed. A verification link's page is the same, without the account name.
- ![registration-ready](p4g-pages/registration-ready.webp) `registration-ready`: Your account is ready, with the way back to the sign-in it came from.
- ![verification-ok-direct](p4g-pages/verification-ok-direct.webp) `verification-ok-direct`: Your account is ready, from a link that carried no request: what to do, no link.
- ![verification-failed](p4g-pages/verification-failed.webp) `verification-failed`: A verification link that cannot be used.
- ![reset-request](p4g-pages/reset-request.webp) `reset-request`: Forgot-password request.
- ![reset-request-failed](p4g-pages/reset-request-failed.webp) `reset-request-failed`: Reset request with no address.
- ![reset-sent](p4g-pages/reset-sent.webp) `reset-sent`: Reset link sent.
- ![reset-new-password](p4g-pages/reset-new-password.webp) `reset-new-password`: Choosing a new password from a reset link.
- ![reset-weak](p4g-pages/reset-weak.webp) `reset-weak`: Reset refused, with the broken rules.
- ![reset-done](p4g-pages/reset-done.webp) `reset-done`: Password reset.
- ![reset-done-direct](p4g-pages/reset-done-direct.webp) `reset-done-direct`: Password reset with no request to go back to.
- ![reset-link-failed](p4g-pages/reset-link-failed.webp) `reset-link-failed`: A reset link that cannot be used.
- ![console-refusal](p4g-pages/console-refusal.webp) `console-refusal`: The admin console's sign-in refusal.
- ![not-found](p4g-pages/not-found.webp) `not-found`: An address nothing serves, shown to a browser (final frame of the drawing).
- ![server-error](p4g-pages/server-error.webp) `server-error`: The failure page with a request id (renderer only; the drawing is still).

- verified: `docker compose` project `odudu-p4g-vis`, the image built from the branch,
  14 console screenshots (seven pages, light and dark) byte-identical before and after.
- verified: Firefox 1511 and WebKit 2272 from `playwright-core` 1.59.0, the sign-in
  with an error, consent and a long-names page at 390px in both themes: `:has()` (the
  hanging checkbox labels), `:nth-last-child(1 of :not(...))` (the trailing margin) and
  the alert marker's `content: '!' / ''` all render as in Chromium; nothing needed a
  fallback.
- assumption: Safari versions older than 15.4 lack `:has()`; there the checkbox sits
  inline before its text, which still reads.

## Increment 18: the documentation app

`apps/docs` is Docusaurus 3.10.2 with `@easyops-cn/docusaurus-search-local` 0.55.3,
built twice from one commit: `build:pages` (base from `site.config.ts`) and
`build:image` (`DOCS_TARGET=image`, base `/docs/`, noindex). The spike findings held;
what the build of the real workspace added or changed:

- verified: `pnpm add` with every dependency in one call, then the two `allowBuilds`
  entries edited over pnpm's `set this to true or false` placeholders, left no dangling
  link (`ls apps/docs/node_modules/@docusaurus/module-type-aliases` populated). The
  lockfile diff is the new importer and its tree: a comparison of the `packages:` keys
  of the second document finds 815 before, 1,876 after and none removed.
- verified: the output goes to `dist/pages` and `dist/image`, not `dist-pages`; the
  existing `dist` rules in `.gitignore`, `.prettierignore` and eslint cover them, and
  turbo's `build` output `dist/**` already names them. `.docusaurus` joins the three
  ignore lists.
- **Tests under `apps/docs/tests` cannot import by relative path** (the
  no-relative-imports lint covers `apps/*/tests/**`), and `#/` is the Docusaurus build's
  failure. `package.json` `imports` maps `#docs/*` to `./*`, which only Node, vitest
  and tsc read; nothing the bundler compiles imports through it. verified:
  `docusaurus build` with the field present, and `vitest run --project unit apps/docs`.
- **`site.config.ts` matched eslint's `apps/*/*.config.ts` default-project glob** while
  also being in the project service through the tests' import, which is a parse error.
  The glob is now `apps/*/!(site).config.ts` (comment in `eslint.config.js`).
  `docusaurus.config.ts` stays out of the tsconfig `include` for the same reason.
- verified: a plugin in TypeScript imported by the config (`plugins/image-strip.ts`,
  passed as `plugins: [imageStrip]`) replaces the planned `image-strip.js`: a CommonJS
  `.js` plugin needs `require`, which `no-require-imports` forbids.
- verified: the console's `fonts.css` imports by relative path from `custom.css`; its
  `url('@fontsource/…')` resolves from that file, so the docs app lists no font package
  and the build emits the same hashed Plex files under `assets/fonts`.
- verified: `docusaurus.config.ts`'s search options need `docsDir: 'content/en'`; without
  it the plugin warns `docsDir doesn't exist: …/docs`.
- The docs tests read `dist/`, so the root unit glob does not include them (`pnpm
test:unit` passes on a tree with no docs build). They run through the turbo `test`
  task, which depends on the build, and `pnpm --filter @odudu/docs test` in the `docs` job.
  `*.browser.test.ts` is its own vitest project (`browser`, only in the `apps/docs` scope),
  run by `pnpm --filter @odudu/docs test:browser`; the root `verify` job has no Chromium,
  so it runs in the `docs` job.
- turbo: `@odudu/docs#build` and `#test` list their inputs explicitly (the content, the
  config files and the console's `tokens.css` and `fonts.css`, which the build imports), and
  `build` names `DOCS_SITE_ORIGIN` and `DOCS_BASE` as environment. The test task depends
  on the build because the tests read `dist/`. `cross-package-reads.test.ts` lists
  `tests/support/dist.ts`.
- verified: a mutation of the colour-mode test. With `respectPrefersColorScheme: false`
  the dark-system case fails (`expected 'light' to be 'dark'`); with it on, both pass.
- Local cost of the added build: `pnpm --filter @odudu/docs build` runs both builds in 7 s on a warm install
  (cold cache each, `docusaurus clear` between). The minutes the `docs` job adds to CI are recorded from its
  first run on the pushed branch.

## The console's theme choice reaches the server pages

The console keeps a light, dark or system choice in `localStorage` and names it
on its own `<html data-theme>`. The server's pages run no script (their policy
is `default-src 'none'`), so after signing out of a console switched to light
the sign-in page followed the operating system and was dark.

- **The cookie `odudu-theme` is the carrier.** The console writes
  `odudu-theme=light|dark; Path=/; SameSite=Lax; Max-Age=31536000` (plus
  `Secure` on an https page) when a theme is chosen and expires it when the
  choice is `system`. `applyRememberedTheme` writes it on start too, so a
  stored choice made before the cookie existed reaches the pages without being
  picked again. `themeCookie` (`shared/service/theme.ts`) builds the string and
  `writeThemeCookie` (`shared/adapter/themeCookie.ts`) sets it.
- **Not a secret and not an identifier.** It holds one of two constants, is not
  `HttpOnly` (the console's script writes it), names nobody, and is read by the
  pages only to choose a stylesheet branch. It is the console's own origin, the
  one the gateway serves the pages from, so it needs no `Domain`; that holds
  because `ODUDU_PUBLIC_BASE_URL` serves both, and is not a guarantee if the
  console is ever served from another host. The browser sends it with every
  request to that origin, `/token` and the administration API included, which
  is harmless for a value that names a colour. The 8,192-character cap on the
  `Cookie` header means a person whose header is longer silently gets no theme.
  At start the console writes the cookie from the stored choice and leaves an
  existing one alone when storage cannot be read. A planted or
  stale value can only change the colour of the page it is sent to.
- **The server reads it in one place.** `pageThemeFromCookies` (`@odudu/kernel`,
  beside `pageHeaders`) takes exactly one cookie of that name whose value is
  exactly `light` or `dark`; anything else, the name twice, a header over 8,192
  characters or a value that is not text is no preference. Nothing from the
  header is ever written into markup: `page()` emits `data-theme="light"` or
  `"dark"` from a two-value allowlist. `pageHeaders` refuses a page whose
  locale carries any other theme.
- **The theme rides on the negotiated locale.** `PageLocale` gains an optional
  `theme`; `requestLocale` and `continuation` in protocol-oidc, account's
  `requestLocale` and the console gateway's refusal each pass the negotiated
  locale through `withPageTheme`, so every renderer, which already takes the
  locale last, gets it. `tests/lint/page-routes-negotiate-locale.test.ts` fails
  a route file that negotiates a page locale without `withPageTheme`.
- **No `Vary`.** Pages are `cache-control: no-store`, so no cache holds one
  to be served under a different cookie.
- **Markup is unchanged without the cookie**: no `data-theme` attribute is
  written, so the recorded documents and `page-documents-transcripts` did not
  move. The inlined brand mark is `currentColor` and follows the page. The
  favicon file `mark.svg` keeps its own `prefers-color-scheme` rule: a document
  loaded as an icon cannot read the page's attribute, and the browser's tab
  strip follows the operating system anyway.

### Increment 18, fix round

- **The image's search index was empty.** `@easyops-cn/docusaurus-search-local` skips
  any page whose `<meta name="robots">` says noindex, and the image says it on every
  page: nine documents indexed in the Pages build, none in the image. verified:
  `node -e` over `dist/image/search-index.json` before and after `forceIgnoreNoIndex:
image` (0 then 9 per index part). The test now asserts the nine sections are in each
  build's index.
- **The image bundle named the Pages host** through `siteConfig.url`, which Docusaurus
  bundles. The image's `url` is `http://localhost` (a required value no page shows: the
  canonical, `og:url` and sitemap are stripped or off), and a test greps every text file
  of `dist/image` for the Pages host. Mutation: `url: SITE_ORIGIN` for the image fails it.
  Task 18c's "a private install never names the public site" can now be held over the
  bundle as well as the HTML.
- The landing and the image home each carry `data-page` (`landing`, `docs-home`); the test
  asserts the marker's presence in the right build and its absence from every image page.
  Mutation: `pages.path` left at `src/pages` for the image fails it.
- The sidebar is asserted from a built page's menu links, in order; deleting `sidebarPath`
  fails it. The two-click walk ignores the footer, which links every section from every
  page. The colour test reads `--surface-panel` from a probe element, so a token retune does
  not fail it.
- turbo: the docs `test` inputs include `scripts/**`. verified: `turbo run test
--filter=@odudu/docs --dry=json` gives hash `b56672f34ee60e7c`, and `da10178b681bbe8a`
  after one line is appended to `scripts/serve.mjs`.
- Carried: `build:image` sets `DOCS_TARGET` inline (POSIX shell). CI is `ubuntu-latest`
  only; the manual Windows quick-start run does not build the docs. A cross-OS CI build of
  the site would need `cross-env` first. The `docs` job repeats the builds and tests that
  `verify` runs through turbo (about two builds, seconds each); its value is Chromium. The
  plan's text still says `dist-pages` and `dist-image` (D4, Task 31b, Task 35's guard b);
  the output is `dist/pages` and `dist/image`.

- **Two console tests fail when run alone under the root `dom` project.**
  `apps/admin-console/src/shared/transport/gateway.test.ts` ("refuses a path
  that would leave /console/api/") and
  `apps/admin-console/src/shared/repository/useWrite.test.tsx` ("throws a
  rejection from a plain write...") fail with an empty message under
  `vitest run --project dom <file>`, and pass under the package's own `pnpm test`,
  which is what CI runs. Confirmed unrelated to the theme work on 16cdf4e9,
  before it. Cause not found. Owner: the CI-speed task, which changes how the
  console's tests are run and has to settle one way of running them.

### Increment 18b: SEO and metadata

- The tests are `tests/seo.test.ts` (pure units), `tests/seo-html.test.ts` (both builds,
  parsed with cheerio, whose parser is parse5; the minifier drops attribute quotes) and
  `tests/seo-swap.test.ts`. They sit in `tests/` and not beside `seo.ts`: the docs scope's
  unit glob is `tests/**/*.test.ts`. `siteHeadTags()` takes no target; the head tags
  carry no address.
- verified: `themeConfig.image: 'brand/social.png'` makes the theme emit both `og:image`
  and `twitter:image`, absolute from `url` + `baseUrl` (`seo-html.test.ts`, over the
  built head). The image build sets no `image`, so it links no social image.
  `static/brand/social.png` is a flat placeholder until the mark exists.
- verified: a `<Head>` child in `src/pages/index.tsx` carries the landing's JSON-LD
  intact (`@graph` of `SoftwareApplication` and `Organization`, no `offers`); the address
  comes from `useDocusaurusContext`, because `site.config.ts` reads `process.env`, which
  does not exist in the client bundle.
- The missing-description check is `plugins/descriptions.ts`, called at the top of
  `docusaurus.config.ts` over `content/en`. verified: deleting one `description:` line
  fails `docusaurus build` with `Pages without a front-matter description:
guides/index.md`.
- The 80-word floor skips the pages listed in `tests/unfilled.json`, which are stubs until
  their increment; filling a page and deleting it from that list turns the floor on for it.
- verified: mutations, each failing the named test and passing after the restore: `<html
lang>` dropped, canonical removed, description removed (Pages); a canonical added to an
  image page and `stripForImage` bypassed (image); `url: SITE_ORIGIN` for the image (bundle
  names the Pages host).
- The swap test builds with `DOCS_SITE_ORIGIN=https://example.test DOCS_BASE=/` into a
  temporary directory (about 8 s) and asserts no file names `wizzywit.github.io`, every
  canonical, the sitemap and `robots.txt` use the new address.
- `robots.txt` is written by `plugins/robots.ts` for both builds: the image's is
  `Disallow: /`, Pages' names the sitemap. The sitemap exclusion `**/search/**` held; the
  test asserts it. The stock theme's accessibility fixes (`--ifm-link-decoration:
underline`, the prism themes) were already in place from the shell; Lighthouse is
  Task 31b's.
- turbo: `seo.ts` joins the docs build and test inputs (hash `48780ee17da6bae9` becomes
  `e716fd6beeb52b3c` after a line is appended).

### Increment 18c: readable by agents

- `docusaurus-plugin-llms` 0.6.1 is pinned exactly. verified: `pnpm view
docusaurus-plugin-llms@0.6.1 license` prints `MIT`, a dev-only dependency that no
  shipped artefact links, compatible with the AGPL-3.0 server of ADR 0042. Its
  transitive additions are `gray-matter`, `js-yaml` 3, `minimatch` 9 (the lockfile also
  re-resolved some peer suffixes).
- verified: Docusaurus runs every plugin's `postBuild` concurrently
  (`Promise.all` in `buildLocale.js`), so a second plugin cannot rewrite what the
  first writes. `plugins/agent-copies.ts` therefore wraps the plugin and runs its
  `postBuild` and then the rewrite in one function.
- verified: `docsDir` is joined to the app directory, so an absolute path finds no
  documents. `DOCS_CONTENT` (default `content/en`, a path relative to the app) lets the
  generated-page test build a docs tree with extra pages; it is a turbo `env` of the build.
- The copy of `a/index.md` is written to `a.md`, and the link rewrite maps each copy back
  to its source by trying `x.md` then `x/index.md`; a page with a front-matter `slug`
  has no such source and fails the build rather than getting a wrong rewrite.
- `llms-full.txt` shifts every heading down a level and drops each description, so its
  sections are matched to pages by order and title (the build fails if either disagrees);
  a section starts at the first `## ` after a `---` line, which a body cannot contain.
- Links in the copies: a site-absolute link gets the base (and the origin for Pages), a
  relative `.md` link is resolved against its source file and named by route, anchors and
  other hosts are untouched, code fences and inline code are skipped. A relative link to a
  non-page file is left as written. A link names the page's HTML route, not its copy.
- `MACHINE_READABLE_REFERENCES` in `nav.ts` is the hook for the generated reference: an entry
  appends a "Machine-readable references" section to `llms.txt`, and the build fails if
  the file is not written. It is empty until the reference lands in Increment 19.
- Tests: `llms.test.ts` (both builds), `llms-generated.test.ts` (a fixture generated page,
  both targets), `agent-links.test.ts`, `agent-references.test.ts`. Docusaurus builds
  from different test files take turns through a lock in `tests/support/build.ts`
  because each writes `.docusaurus`.
- verified: mutations, each red and green after the restore: a page ignored by the plugin
  (listing test, Pages), `keepFrontMatter` set (copy keeps front matter), the image built
  with `useRelativeUrls: false` (names `http://localhost`), the base dropped from a rewritten
  link (unit and generated-page tests).

### CI runs what a change can affect

ADR 0044 has the design. Findings that belong to this phase:

- **The `docs` job's timeout was a hang, not a slow build.** verified: `gh run view --job
118032200829 --log` shows `pnpm --filter @odudu/docs test` running the `browser` project
  before Chromium was installed, then `[vitest-pool]: Timeout terminating forks worker`
  and nothing more until cancellation. `afterAll` called `browser.close()` on `undefined`
  before `server.kill()`, so the `serve.mjs` child held the worker open. Reproduced
  locally with `PLAYWRIGHT_BROWSERS_PATH=/nonexistent`: the old file hung until
  killed (exit 142 from a 60 s alarm), the new one fails in under a second.
  The same hang followed `protocol-admin`'s tests at the end of the cancelled `verify`.
- The docs `test` script now runs `--project unit`; `test:browser` runs after
  Chromium is installed. The build lock in `tests/support/lock.ts` steals a lock whose
  owner is gone or that is older than its deadline, releases in `finally`, and is per
  checkout; builds have a timeout.
- verified: `ODUDU_TEST_SHARD=1/2 turbo run test --filter=@odudu/kernel` then `2/2` then
  unset give three different task hashes while `@odudu/contracts:typecheck` keeps one
  (`cache hit`); a `--shard` argument after `--` changed the typecheck hash too.
- verified: `turbo run test --affected --dry=json` with the base at `HEAD~1`, where the
  commit touched only `docs/phases/p4g.md`, lists no test task, though
  `tests/docs` reads that directory. `--affected` is not used.
- The two console dom tests the notes above recorded as failing alone did not fail on
  2026-10-19: `vitest run --project dom <both files>`, each file alone, and
  `vitest run <both files>` all passed. Left open in `docs/NEXT.md`.
- assumption: GitHub reports a skipped job as passing for a required check, and
  `actions/cache/save@v6` on an existing key warns rather than fails. Look at the first
  docs-only run and at a rerun of one commit.

### Increment 18c, fix round

- **The rewrite is tested against hand-written expectations**, one row per link form for
  both bases (`agent-links.test.ts`): inline links and images with titles, fragments and
  queries, balanced parentheses in a URL, `<...>` destinations, reference definitions, raw
  `<a href>`/`<img src>` with quoted attributes, and the forms that must be left alone
  (autolinks, other hosts, fences, inline code). Raw HTML is read one line at a time and
  only with quoted attributes; the plugin drops raw tags from its copies anyway, so a raw
  anchor does not survive into one.
- **Every reference in a copy is checked by a CommonMark parser**, `mdast-util-from-markdown`
  2.1.0 (already in the tree through Docusaurus's MDX stack; pinned directly because the
  tests import it): links, images, definitions, autolinks and raw HTML attributes must be
  fragments, external, or under the build's prefix and resolve to a file the build wrote.
  The body of a copy is compared with its source by node type and text, ignoring
  addresses, so the rewriter is not on both sides of the comparison.
- **Slugs.** A page with a front-matter `slug` has a copy named by its route, which no
  source file matches, so the build fails with `No source page for the Markdown copy`
  (tested). Authors of pages, generated ones included, must not set `slug`, a numeric
  file-name prefix, or a `dir/dir.md` index until the copy is mapped by the page's route.
- **`---js` front matter** (and any other language tag) is refused by
  `plugins/descriptions.ts`: the front-matter reader evaluates it, so the documentation
  is trusted to be authored by maintainers only. `description: ""` counts as missing and
  a file or directory starting with `_` is skipped, as Docusaurus skips it.
- **`DOCS_CONTENT`** is refused unless it names a directory under `node_modules/.cache/`
  (`plugins/content-dir.ts`), so a deploy that inherits it cannot publish a fixture.
- **Closing the stubs.** `tests/unfilled.json` is already held both ways by `ia.test.ts`.
  With `DOCS_REQUIRE_FILLED=1` a further test requires it to be `[]`; the step that closes
  the documentation sets it for the docs tests (turbo does not hash it, so that step runs
  vitest directly or with the cache bypassed).
- Smaller: `stripForImage` reads `rel` as a token list; the `llms.txt` line parser keeps a
  `]` inside a title; the seo tests assert the hreflang set exactly, the sitemap's excluded
  routes exactly, and that Pages pages carry no robots meta (the image test already asserts
  noindex on every image page).

#### Validating the CI restructure

Run on a throwaway branch with a draft pull request into the phase branch, never
`main`, with the `gate` job from this branch present. Each scenario is a push;
read the run's job list and the merge box. Nothing below has been observed yet.

1. **A prose-only line.** Append one line to `docs/NEXT.md`.
   - `changes` prints `server=false`, `buildImage=false`, `docsOnly=true`.
   - The test matrix, `trace`, `e2e`, `conformance`, `query-plans` and `container`
     show skipped. `static`, `docs`, `test-rest` (which runs only `repo-checks`),
     `verify`, `commit-messages` and `gate` are green.
   - The merge box counts the skipped required checks (`container`, `query-plans`) as
     passing. This settles whether a job-level skip satisfies a required check; until it
     is seen, keep `gate` beside the old names rather than instead of them.
2. **Code, then a move into `docs/`.** First change one line in a package source
   file and push; everything runs and `server=true`. Then, as a separate push,
   `git mv` of a package source file to a Markdown name under `docs/`.
   - `changes` still prints `server=true`, `docsOnly=false`: the old path counts.
   - The matrix, `trace`, `e2e` and the rest all run; `gate` is red for the real
     failure the move causes (the package no longer builds), not for skipping.
3. **A failing slice.** Add a failing assertion to one `protocol-oidc` test file
   and push.
   - That leg is red, and its collect and upload steps are skipped (`if: success()`);
     its "Save the Turborepo cache" step still runs.
   - The other legs finish; `trace` is skipped; `verify` and `gate` are red.
   - Revert and push: the next run restores the previous caches (`cached` counts in each
     leg's turbo summary) and is faster than the first.
4. **Also check** while those run: the Chromium step in `docs` hits its cache on the
   second run; `gate` fails when you cancel a run midway; and the Actions cache list
   holds about 14 entries per run, not hundreds.

5. **The e2e slices.** `e2e` is three legs (`e2e 1/3` to `3/3`) and one `e2e` job.
   - Wall time of the job: target 8 to 10 minutes, from 19 (run 39254678576). Read each
     leg's steps: image build under 1 minute cold, seeding about 2.3 minutes, tests
     about 5. Legs should end within a minute of each other; if one is far behind,
     count tests per leg in the log before changing anything.
   - On the second run of the same lockfile the "Build the image" step shows layers as
     `CACHED` (or `importing cache manifest`) and the `pnpm fetch` layer is not re-run;
     `container` shows the same. Only a push to main writes the cache, so a pull request's
     first run is cold until main has run once with the new Dockerfile; then the Actions
     cache list holds one `odudu-image` scope for main. Slice 1 is the slowest leg by
     about a minute: expected, not a fault. `container` fails with 'was built from' if
     the image's revision label is not the commit.
   - On a docs-only push `e2e` and the three legs are skipped; cancel one leg and
     `e2e` and `gate` go red.
   - A leg that fails uploads `playwright-report-<index>`.

Only after 1 to 3 behave as written, require `gate` on `main`, and later drop
`verify`, `container` and `query-plans` from the required list.

## Increment 19: the reference is generated from the code

`pnpm --filter @odudu/docs generate` (`apps/docs/scripts/generate.ts`) writes
the reference pages and the admin OpenAPI document; `build:pages` and
`build:image` run it first. It imports the real sources, never copies a value:
`buildAdminOpenApiDocument` and `ADMIN_ROUTES` from `@odudu/protocol-admin`, the
CLI registry and the route listing from `@odudu/server`, `configSchema` and the
error and config tables from `@odudu/kernel`, the audit vocabulary from
`@odudu/domain-audit`, the OAuth error table from `@odudu/protocol-oidc`.

- **Generated at build time, gitignored, checked for currency.** The pages go to
  `content/en/reference/generated/` and the document to `static/openapi/`, both
  in `.gitignore` and `.prettierignore`; `generated-not-committed.test.ts` holds that
  with `git check-ignore`. `generate.test.ts` regenerates in memory and compares
  every byte with the files on disk (the commit named in the banner aside), so
  tests that read a tree built from older code fail. Every page is front matter,
  then `<!-- Generated from <source> at <commit>; do not edit. -->`, then the
  renderer's output; `ODUDU_COMMIT` replaces `git rev-parse` where there is no `.git`.
- verified: `node --no-warnings scripts/generate.ts` runs under Node 24 with
  `@odudu/protocol-admin` and `@odudu/server/src/cli/registry.ts` imported by name
  (the server has no `exports`, so a deep path resolves; protocol-admin has, so
  its OpenAPI builder had to be exported from the index): `generated 24 files`, 1.3 s.
  `apps/docs/scripts/package.json` (`"type": "module"`) stops Node reparsing
  each file; the app's own package stays without it.
- verified: a Markdown link whose target is `/openapi/admin.json`, a file in `static/`, is bundled by
  Docusaurus as a hashed asset: `dist/pages/assets/files/admin-<hash>.json`, a second
  890 KB copy per target. `pathname:///openapi/admin.json` renders `href=/odudu/openapi/admin.json`
  and copies nothing. `agent-links.ts` now rewrites that form in the Markdown copies.
- verified: a docs page outside every sidebar has no sidebar and no breadcrumb, which
  `seo-html.test.ts` and `ia.test.ts` both refuse. The Reference section is therefore a
  category with `link: reference/index` and `autogenerated: reference/generated`; the
  admin API's `_category_.json` names its folder. A breadcrumb ends at the sidebar label,
  so a page does not set `sidebar_label`: its title is the label.
- The OpenAPI document has no tags and carries the capability only in prose, so a page is
  one **area** (the segment after `{tenant}`; the tenant collection, an export and an import
  are `tenants`) and an operation names its capability by the document's own `summary`.
  `$ref` to a component and the problem-details body are written once, on the index page.
- **Escaping.** In `.md` a `{x}` is text, a `<tag>` or `&entity;` is HTML, so `markdown.ts`
  turns `<`, `>` and `&` into entities outside code spans and leaves fences alone; `|`
  becomes `\|` in a table cell. `openapi-pages.test.ts` parses a hostile description with
  `mdast-util-from-markdown` and asserts it yields no HTML node.
- **Where the vocabularies live.** `ErrorCode` was a type with no runtime list: it is now
  `ERROR_CODES` and a type derived from it, and `ERROR_DOCS` is a `Record<ErrorCode, …>`, so a
  new code without a sentence is a compile error. The same holds for `CONFIG_DOCS` over
  `keyof typeof configSchema.shape`, `AUDIT_ACTION_DOCS` and the reason and event-type
  tables. Three vocabularies have no typed list in the code, so each has a registry and a test
  that reads the source and fails both ways: `ADMIN_PROBLEM_TYPES` (every `about:blank#…`
  under `protocol-admin/src/view` plus the contracts constant), `ADMIN_MUTATION_ACTIONS`
  (every `action: '<resource>.<verb>'` literal), `OAUTH_ERROR_DOCS` (typed over the
  `TokenErrorCode` union and checked against the source for the rest). An action built from a
  variable would not be seen by the second; today every route names its action as a literal.
- `git grep -n "new OduduError('" -- packages apps | wc -l` is 85 now, and the distinct codes in
  `ErrorCode` are 55.
- Defaults are read from the loader: `configReference()` runs `loadConfig` over the two required
  keys and reads what it produced, because a switch's default (`ODUDU_OUTBOX_ENABLED` is on unless
  `false`) lives in a transform that the JSON Schema of `z.toJSONSchema(configSchema, { io: 'input' })`
  cannot show; the schema gives type, bounds and enum. `config-docs.test.ts` also sets each
  default explicitly and asserts nothing changes.
- **README.** It has no environment variable table (its variables are in prose), so there is none to
  keep equal to the generated page; Increment 32 rewrites the README and links the generated page.
  Until then `tests/docs/config-defaults.test.ts` holds every "`ODUDU_X` (default `n`)" in the README
  and the two path guides to the loader's default and to a variable the loader reads.
- **The route extractor missed a route.** `tests/docs/endpoints.test.ts`'s tree parser did not match
  `└── -reset (POST)` (`/admin/tenants/:tenant/subjects/:id/password-reset`), so that route was never
  compared with the documents. It moved to `apps/server/src/served-routes.ts` (the docs generator
  needs it too) with a pattern that matches a segment starting with `-`; the documents already
  listed the route.
- turbo: `@odudu/docs#build` no longer depends on `^build` (the workspace packages it now depends on
  are read from source, and `@odudu/server`'s build is a bundle the docs do not use), takes
  `scripts/**`, `packages/*/src/**` and `apps/server/src/**` as inputs, and leaves out
  the two generated directories, which the build itself writes. `references.test.ts` skips the
  generated directory: a checkout that has not built has none, and the build checks its links.
- **Size.** Before: `dist/pages` 2,168 KB, `search-index.json` 12.3 KB (2.2 KB gzip). After:
  5,548 KB, `search-index.json` 973 KB (170 KB gzip). 22 generated pages: 986 KB of HTML, 160 KB
  gzip; the largest is admin-api/subjects (156 KB, 13.9 KB gzip; 34 operations), then clients (85 KB),
  scopes (70 KB), the CLI page (65 KB). `openapi/admin.json` is 890 KB (33 KB gzip). `llms-full.txt` is
  261 KB, the Markdown copies of `reference/` 259 KB. The search index is fetched on the first
  search, not on page load. If Task 31b's Lighthouse budget fails on subjects, split it by what
  hangs off a subject (credentials, sessions, grants) rather than loosening the budget.
- verified: mutations, each red and green after the restore. An operation dropped by the renderer
  (3 tests fail); escaping removed (the hostile-description test fails); a route removed from
  `ADMIN_ROUTES` with no regeneration (the on-disk currency test fails); a CLI option removed from
  `INIT_OPTIONS` (the on-disk test fails; the registry's own tests stay green because the help text
  derives from the same table); `ODUDU_REAP_INTERVAL_SECONDS` renamed in the schema (six
  `config-docs` tests, `config-defaults.test.ts` and the on-disk test fail, naming the variable);
  an `about:blank#…` literal removed from `keys.ts` (the problem-type test fails); a code removed from
  `ERROR_CODES` (a compile error and the code test); an audit action added without a sentence; a route
  removed from the app; an OAuth error replaced in the source.
- **`pnpm lint` needed more memory, and the cause was the docs app's typed program.** verified:
  with the generator and its tests in `apps/docs/tsconfig.json` (Docusaurus options) the typed
  program over the workspace sources was a second, unshared one, and `eslint .` ran out of heap
  (a V8 stack dump). The generator, its renderers and their tests now live under `apps/docs/scripts/`
  with their own `tsconfig.json` extending `tsconfig.base.json`; `vitest.config.ts` takes
  `scripts/**/*.test.ts` into the docs scope. `/usr/bin/time -l node_modules/.bin/eslint .` at the
  default heap passes: 4.5 GB peak resident (4.3 GB with `apps/docs` ignored), 2 min 33 s. The
  `--max-old-space-size` flag is gone from the `lint` script.

### Increment 19, fix round

- **A cached build keeps the generated pages.** `@odudu/docs#build` lists `content/en/reference/generated/**`
  and `static/openapi/**` as outputs and `ODUDU_COMMIT` as an env input (the commit the banner names). verified:
  `ODUDU_COMMIT=aaa111 pnpm turbo run build --filter=@odudu/docs` is a miss, the next run a hit, and after
  deleting both generated directories a third run is a hit that restores them (the banner still says `aaa111`);
  `ODUDU_COMMIT=bbb222` is a miss and rewrites the banners. The root `test` and `verify` scripts export it from
  `git rev-parse`. A workflow that calls `turbo` directly has to export it too (`ODUDU_COMMIT: ${{ github.sha }}`
  is one line in the `docs` job); without it the banner names the commit at generation time and a cache hit can carry
  an older one. Package tests are excluded from the inputs and the packages' `package.json` files are in.
- **Admin mutation actions are typed.** `ADMIN_MUTATION_ACTIONS` is a tuple in `domain-audit` and
  `AdminMutationInput.action` is its union, so `recordAudit`, `auditRepository.record` and the CLI refuse an unlisted
  action at typecheck. Making it compile found four the literal scan could not see: `console.assertion` and the three
  `subject.*_send` actions, whose union types span lines. `tests/docs/audit-actions.test.ts` scans every production
  source as a second check.
- **Variables outside the loader** (`ODUDU_ADMIN_EMAIL`, `ODUDU_ADMIN_PASSWORD`, `ODUDU_VERSION`) are a second table
  on the configuration page, and `tests/docs/env-reads.test.ts` fails on any `env.ODUDU_*` read in a production
  source that is neither a loader key nor in it. `requiredWhen` on five keys says what the server cannot start without
  (the console, on by default, needs `ODUDU_PUBLIC_BASE_URL` and `ODUDU_CONSOLE_CLIENT_KEY`);
  `apps/server/src/config-required.test.ts` holds each claim to its guard.
- **The endpoint listing is exact.** `buildApp` takes an `onRoute` hook, and `servingApp()` (now in
  `apps/server/src/testing/`, which the bundle never imports) builds the app with the console, a generated console
  key and a stylesheet directory, so `/console/*` and `/instrument/*` are listed. The old `printRoutes` parser is gone;
  it showed wildcards under the wrong prefix. The routes that only answer `404` for an unclaimed path under
  `/console/auth` and `/console/api`, and the CORS preflight, are `NOT_LISTED`, and the page says so. The admin
  sentence says "under `/admin`", asserted over `ADMIN_ROUTES`.
- **OAuth error codes are typed per surface.** `AUTHORIZATION_ERRORS`, `TOKEN_ERRORS`, `USERINFO_ERRORS` and
  `REGISTRATION_ERRORS` are tuples; the authorization outcomes, `errorRedirect`, the userinfo and registration
  challenges take their unions, and `surfacesOf(code)` reads where a code is answered from them. A test checks each list
  against the modules of its surface. (The earlier check searched the whole source tree for `'code'`, which a
  documentation table in the same tree satisfied.)
- **Readability.** Known patterns and formats are put in words (a UUID, an ISO 8601 date and time, no bidirectional
  control characters), a pattern the generator does not know is listed after the operation in a collapsed
  `<details>` block, plurals are right, a table that stops at the depth limit says so and links the OpenAPI document,
  and every area page ends with `Documentation coverage: n of m fields described`. Descriptions are written in
  `packages/contracts/src/admin/docs.ts`, apart from the schemas, and five request or response bodies carry an example (create client, create user,
  set required actions, a page of audit events, create tenant; settings has one too).
  `apps/docs/scripts/coverage-ratchet.test.ts` holds each area to the baseline below; an area new to the API must be added.
  The areas below 50% (`groups`, `roles`, `mail`, `smtp`, `whoami`) were left to the guides increments, which write for the
  areas they describe; the console tour (Increment 26) described all five and filled them (see the Increment 26 section).

#### Admin API documentation coverage

| Area                  | Described | Fields |
| --------------------- | --------- | ------ |
| `audit`               | 60        | 60     |
| `clients`             | 524       | 535    |
| `flow`                | 12        | 12     |
| `groups`              | 62        | 67     |
| `keys`                | 31        | 31     |
| `lockouts`            | 3         | 3      |
| `mail`                | 49        | 52     |
| `message-catalogue`   | 5         | 5      |
| `message-overrides`   | 14        | 14     |
| `registration-tokens` | 14        | 14     |
| `roles`               | 65        | 65     |
| `scopes`              | 102       | 107    |
| `sessions`            | 18        | 18     |
| `settings`            | 0         | 0      |
| `smtp`                | 22        | 24     |
| `subjects`            | 139       | 139    |
| `subject-access`      | 43        | 44     |
| `subject-sessions`    | 31        | 31     |
| `subject-sign-in`     | 12        | 17     |
| `tenants`             | 186       | 213    |
| `theme`               | 238       | 238    |
| `whoami`              | 4         | 4      |

- The `generate.test.ts` comparison of the files on disk with a fresh generation guards a stale local tree; in CI
  the build regenerates just before the tests run, so it is not a drift check there. What keeps the reference from
  drifting is derivation, and the typed tables above.

- **Descriptions are kept out of the console's bundle.** verified: writing them with `.describe()` on the contract
  schemas took the console's first load to 246,513 B gzipped against a budget of 242,000
  (`tests/lint/console-phone-chunk.test.ts` failed), because the console imports the same schemas to validate.
  `docs.ts` holds them instead, found by field names and applied by `documentedJsonSchema` when the OpenAPI document is
  built (a shape is matched when it makes up four fifths or more of an object's fields); the console never imports it.
  The documentation packages' prose (`CONFIG_DOCS`, `ERROR_DOCS`, `ADMIN_PROBLEM_TYPES`, `OAUTH_ERROR_DOCS`, the audit
  tables) moved to a `./docs` subpath of each package for the same reason: verified by building the server, whose bundle
  carried that prose before the move and does not after (`grep` for a sentence of each in `apps/server/dist`).

## Increment 20: the documentation inside the image

`/docs` is served by `@odudu/web-assets` (`docsRoutes`, `docsPolicy`) from the built `apps/docs/dist/image`,
copied to `/app/docs`; ADR 0029's second amendment has the design.

- **Size.** verified: `du -sk /app/docs` in the image is 6,184 KB over 135 files (`dist/image`, 134 plus the
  `csp.json` the build writes), against the route's bound of 5,000 files and 64 MiB. The built site is the
  `search-index.json` (1.1 MB), `openapi/admin.json` (985 KB), `llms-full.txt` (306 KB) and the pages; it is
  read into memory once at boot, so the server holds about 6 MB more resident. The pages are not compressed
  by the server (the largest, `reference/generated/admin-api/subjects`, is 156 KB): a reverse proxy does that.
- **The runtime image was 1.26 GB before this increment and is 383 MB now, for a reason that is not the docs.**
  verified: `docker image inspect odudu-p4g-docs-odudu --format '{{.Size}}'` gave 1,262,971,531 with the docs
  stage added and the old `prod-deps` stage; `/app/node_modules/.pnpm` held 1,722 packages (788 MB: vitest,
  typescript, eslint, Docusaurus, `@rspack`, turbo). Since `pnpm fetch` is the first layer (ADR 0044), pnpm
  12.3.4 materialises the whole virtual store in `node_modules/.pnpm` and runs install scripts there; the
  later `pnpm install --prod --offline` unlinks the devDependencies from the top level and leaves their
  directories. `rm -rf node_modules` before that install takes the image to 383,096,741 bytes with 252 packages
  and none of those (`ls /app/node_modules/.pnpm | grep -cE '^(vitest|typescript|@docusaurus)'` prints 0), and
  `import('@node-rs/argon2')` still resolves from `/app`. The docs add about 6 MB of that. The old
  `odudu-e2e-odudu` image, built before the fetch layer, was 372,632,477.
- **Policy.** `dist/image/csp.json` holds 1 script hash and 7 style-attribute hashes (the seven values are listed
  in the amendment). The scratch finding (12 values, two locales) is smaller because the image has one locale
  and no landing page. verified: mutations, each failing and passing after the restore. A hash removed from
  `csp.json` fails `csp.test.ts` ("names the hash of every executable inline script and style attribute") and
  the Chromium walk (84 `style-src-attr` violations reported); an inline `<script>window.x=1</script>` added to a
  built page with `csp.json` regenerated to include it fails "exactly one executable inline script per page";
  `scripts/csp.test.ts` refuses a `<style>`, an `on*` attribute and a `javascript:` URL.
- **The walk is `scripts/csp.browser.test.ts`**, not `tests/csp.test.ts`: the root `unit` project has no Chromium, so
  it is a `*.browser.test.ts` (the `browser` glob now takes `scripts/` too) and runs where Chromium is installed, in
  the `docs` job's `test:browser` step. It sits in `scripts/` because it imports `@odudu/web-assets` and `fastify`,
  and a workspace import from `tests/` joins the Docusaurus-options program, the unshared second program that ran
  `eslint .` out of memory in Increment 19; `scripts/` extends `tsconfig.base.json` (plus the `dom` lib, for the
  callbacks `page.evaluate` runs in the page). `tests/csp.test.ts` imports no workspace package for the same reason,
  and the check that `csp.json` is accepted by the server is in `scripts/csp.test.ts`.
  It serves the image through the real `docsRoutes` on an ephemeral port, so the header under test is the one the
  server sends. It covers navigation, the colour toggle three times, a search that fetches
  `/docs/search-index.json` from the same origin, Enter in the box, code copy on the CLI reference (the first page
  with a code block; `quick-start` has none while its section is a stub), and the mobile menu with the toggle in
  it at 390 px; a last case injects a script and a style attribute and expects both violations, so a silent
  pass is not a broken listener.
- **The CLI reference names `http://localhost:3000`**, the address `odudu` serves on by default, and the build
  renders it as an anchor. `csp.test.ts` allows that one value as an absolute anchor and nothing else; the
  build's placeholder `url` (`http://localhost`, no port) is checked absent from every page and agent copy.
- **Path prefix.** The README's Deploying list says the site must sit at the root of `ODUDU_PUBLIC_BASE_URL`.
  The operating section's Deploying page (Task 27) is not written, so the ADR names the README for now; that
  page states it with its own test, as the plan's Task 27 already lists.
- **Not done here, and where it goes.** The server does not compress, which a reverse proxy
  normally does; P11's load work owns measuring it. `OPTIONS` and writes under `/docs/` answer Fastify's `404`
  without the docs headers, as `/console/*` does: they carry no document.
- **The `docs` and `container` jobs** run this on push: `docs` runs `test:browser` (the walk), `container` runs the
  smoke additions. Nothing here has been seen green in CI yet.
- **`pnpm lint` runs out of memory at Node's default heap on this machine, at the commit before this increment
  too.** verified: `pnpm lint` at `77812712` in a fresh worktree ends `FATAL ERROR: Ineffective mark-compacts near
heap limit` at 4.56 GB resident; with `NODE_OPTIONS=--max-old-space-size=8192` it passes, 5.29 GB peak, 2 min 27 s,
  and the same run on this increment passes at 5.01 GB. So the increment adds nothing measurable, and the margin
  Increment 19 recorded ("4.5 GB peak resident at the default heap passes") is gone on Node 24.15.0 and macOS arm64.
  The `static` job runs `pnpm lint` with no `NODE_OPTIONS`; whether ubuntu-latest passes is unobserved. If it does
  not, the `lint` script takes the flag back or the typed program shrinks again; that decision is the controller's.

### Increment 20, fix round

- The Chromium walk now `goto`es every built HTML page as a document (35 routes from the built tree, `404.html` through
  an unknown path), one browser and context. verified: an inline script added to `quick-start/index.html` without
  regenerating `csp.json` fails it; the same page passed the old walk.
- The policy gains `object-src 'none'` and `frame-src 'none'`; workers fall back to `default-src 'self'`.
- The docs headers are on every response the route's handlers produce. Fastify's own `400` (malformed percent-escape)
  and `404` for methods other than `GET`/`HEAD` carry none; a root hook would touch every other route, so the wording
  was narrowed instead (ADR 0029, `request-paths`).
- `scripts/csp.test.ts` fails, naming the file, on any built file whose extension is not in `DOCS_TYPES`.
- The docs routes log nothing per request (`logLevel: 'warn'` on the route); warnings and errors still print. A page
  load was about 20 info lines. Not done, kept as notes: no compression (P11), `csp.ts` does not read a `style=` inside a
  `<template>` (Docusaurus emits none), and the immutable rule is by name shape under `assets/`.
- **`lint` pins its heap.** Node's default old-space limit is about 4 GB on 64-bit (4,288 MB here, whatever the RAM
  above 16 GB), and `eslint .` peaks at 5.0 to 5.3 GB resident, so a bare run is a coin flip on GC timing. The script is
  `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js .`, cross-platform, so local, `pnpm verify` and CI
  agree; 8192 would not be backed by a 7 GB runner. Shrinking the Docusaurus-options typed program is the longer-term fix.

## Recovery-code lifecycle

Recovery codes had a creation path and a spend path and nothing in between: an administrator could remove a TOTP
enrolment and leave the set that stood in for it, so a re-enrolment silently revived codes that may have left with the
lost device. This increment gives the set a lifecycle. The concept page for the docs site is the "Recovery codes"
section of `concepts/sessions.md` (Increment 25); this section is its source.

### Recovery codes

- **What a recovery code is for.** It stands in for a TOTP code at the second-factor step, once. It is not itself a
  factor at all, so a subject whose only "factor" is a set of codes has none.
- **What a recovery code stands in for: a TOTP, and only a TOTP.** The login accepts a code only at the TOTP code step
  (`recoveryApplicable`, which now also needs the subject to hold a TOTP, whatever the tenant's `otpRequired` says of
  others), and never after a passkey. So `recoveryStanding.hasTotp` counts `totp` rows alone. Consequences, all tested
  through `advance`: removing the last TOTP revokes the set even while a passkey remains; passkey enrolment owes no set
  (ADR 0021's amendment, dated 2026-10-19); a surviving code offered beside a password by a subject with no TOTP is
  neither accepted nor spent, with `otpRequired` on or off and a passkey held or not. With `otpRequired` on, a
  passkey-only subject signs in with the passkey, where the code step does not apply, as before, and a subject with
  neither owes `configure-totp`; before this round a surviving code was offered to such a subject as the second factor.
  The earlier reading, that a passkey is a factor a set protects, was wrong and is superseded.
- **Removal.** `onSecondFactorRemoved` (`@odudu/authn-flows`) runs after a TOTP or passkey row is deleted, in the same
  transaction and with the subject row locked (`FOR NO KEY UPDATE`, as every admin mutation takes it). With no second
  factor left it deletes the whole set, spent rows included, and records `subject.recovery_codes_revoke` with
  `{revoked, reason: "last_factor_removed"}`; with a TOTP left, or no codes held, it writes nothing. It also completes an
  owed `generate-recovery-codes` whenever no TOTP remains. The only path that
  removes a second-factor row today is the admin API's `deleteCredential` (verified: `grep -rn "deleteOne" packages apps
--include='*.ts'` finds that one caller; password-history trimming and `deleteRecoveryCodes` are the other deletes).
  P4f's self-service removal calls the same function.
- **Admin revoke.** `DELETE …/recovery-codes?require_new_set=true|false`, default true. With a TOTP remaining
  and the flag true it adds `generate-recovery-codes` in the same transaction; with no TOTP remaining nothing is added
  whatever the flag says. The audit detail is `{revoked, new_set_required}`.
- **Sign-in check.** After a sign-in completes (every factor satisfied, not merely the first), a subject who holds a
  TOTP and no unspent code owes `generate-recovery-codes`. One aggregate query (`recoveryStanding`) on the
  success path; the action is only added, and `completeRecoveryCodes` clears it once a set exists, so it cannot loop.
  It does not run for a password-only stage, so a password alone earns no prompt about a factor it did not present.
- **Owner notice.** `renderSecondFactorRemoved` and `renderRecoveryCodesRevoked` in `@odudu/email`, queued through the
  outbox in the admin transaction. The rule: sent to the address on file, verified or not, because the message carries no
  link, code or factor detail and an unverified address learns nothing from it; skipped without a trace when the subject
  has no address; none for a revoke that found no code. The tenant name goes through the catalogue's isolate and subject
  cleaning like every other mail.
- **Ending sessions.** The per-subject end exists (`DELETE …/sessions`), so the console's removal dialog offers
  "Also end the subject's sessions" when the factor is the last one. Unticked by default: whether the factor was lost or
  stolen is something only the operator knows, and the dialog says so. The two calls are separate; if the second fails
  after the first succeeded the dialog reports the failure and the tab shows what the server holds.
- **Confirmed unchanged.** First enrolment issues a set (`recovery-codes.int.test.ts`, "owes generate-recovery-codes to a
  subject who has just enrolled TOTP"), regenerating replaces the old ten (same file, "replaces the whole set when a
  subject generates again"), and wrong recovery codes count toward the second-factor lockout (`second-factor-lockout.int.test.ts`,
  "wrong recovery codes count too"), so nothing needed adding for those.
- **A behaviour change worth knowing.** A subject with a TOTP and no codes, which is every subject enrolled before codes
  existed and every one revoked with `require_new_set=false`, is now asked for a set at their next sign-in. That is the
  point; one existing integration test (`subjects.int.test.ts`, the TOTP removal) seeded such a subject and now seeds a
  saved code, the state an ordinary enrolment leaves.
- **Issuing is serialised with removal.** `beginRecoveryCodes` takes the subject row lock (`subjectRepository.lock`, which
  `lockSubjectRow` in protocol-admin now delegates to) and issues only while a TOTP is held; otherwise it clears
  the owed `generate-recovery-codes` action and answers `{kind: 'no_second_factor'}`, which both page doors turn into the
  expired-sign-in page. A set therefore never exists for a subject with no factor. verified: the interleaving test in
  `recovery-lifecycle.int.test.ts` ("never leaves a set behind a removed last factor") holds the issuing transaction open
  while the removal starts on a second connection; removing the lock from `beginRecoveryCodes` fails it.
- **End sessions is part of the removal.** `DELETE …/credentials/{id}?end_sessions=true` calls `endAllSessions` inside the
  removal's transaction (`DeleteCredentialDeps.endSessions`, injected because the sessions usecase imports the subjects
  one), needs `manage-sessions` too, and records `detail.ended_sessions` on `subject.credential_delete`. The console makes
  one request.

### What NIST requires of look-up secrets

Read directly from the SP 800-63B-4 pages on 2026-10-19 (`https://pages.nist.gov/800-63-4/sp800-63b/authenticators/`
and `…/events/`), paraphrased:

- **§3.1.2.1, the authenticator.** Generated with an approved random bit generator; delivered securely, and when
  delivered online, within a session authenticated at AAL2 or higher; at least six decimal digits or equivalent.
- **§3.1.2.2, the verifier.** Prompts for a secret; accepts each secret successfully once; stores them hashed with an
  approved function; a secret under 112 bits is salted (salt at least 32 bits) and hashed with a password hashing
  scheme, and the verifier rate-limits failed attempts on the account (§3.2.2's bound is 100 consecutive failures).
- **§4.3 and §4.5, compromise and invalidation.** Lost, stolen or duplicated authenticators are compromised and are
  invalidated promptly; invalidation is also owed when the subscriber asks and when the account ceases to exist.
- **§4.1.2.1 and §4.6, notice.** An added authenticator is notified through a channel independent of the binding; events
  that change authenticators trigger notices to the addresses on file, with instructions for someone who did not do it;
  issuing a replacement recovery code set is one of them (§4.2).

Where Odudu stands: ten characters from a 32-character alphabet are 50 bits, far over the floor, drawn from
`node:crypto` `randomBytes`; each is Argon2id-hashed with its own salt (the same parameters as a password), so the
under-112-bit rule is met; single use is a conditional `UPDATE`; failures count against the tenant's second-factor
lockout, whose threshold is a tenant setting that a CHECK holds to at most 100 and that defaults to 5; the codes page is reached only through a
completed sign-in. Revocation on compromise was the gap (an operator could not tell the server a factor was lost without
orphaning its set), now closed by the removal rule; the notice for an administrator's change is added here (to the address on file, verified or not, since
it carries nothing a stranger could use). Not met, and
placed: a notice when the subject's own enrolment or regeneration changes their authenticators, which is **P4f** (the
design spec's P4f criterion and `apps/docs/content/en/roadmap.md`'s "What is not implemented" now name it).

- verified: `cd packages/authn-flows && ../../node_modules/.bin/vitest run --config ../../vitest.config.ts tests/recovery-lifecycle.int.test.ts`
  (12 tests) and the same from `packages/protocol-admin` with its own `tests/recovery-lifecycle.int.test.ts` (10 tests),
  both against real PostgreSQL; the console's Chromium run, `subjects.spec.ts` on the stack `odudu-p4g-recovery`, 15 passed.
- Mutations, each failing the named test and passing after the restore: dropping the second-factor condition from
  `onSecondFactorRemoved` ("keeps the set while a passkey remains"); dropping it from the sign-in check ("owes nothing
  to a subject with no second factor"); removing the sign-in call from `advance` (three tests); counting a passkey as a factor again
  ("revokes the set with the last TOTP even while a passkey remains"); ignoring `require_new_set` in the
  handler ("owes nothing when require_new_set is false"); owing a set with no factor left ("owes nothing to a subject
  with no second factor"); letting the executor offer the code step for a subject with no TOTP ("is neither accepted nor spent");
  mailing a revoke that found nothing ("writes no mail when no code was held").

### Fix round 2

- A passkey is not what a set protects; see "What a recovery code stands in for" above. The unverified-address rule has a
  cost the P4f row now names: self-registration with somebody else's address can make an administrator's notice mail a
  stranger the tenant name and the fact that an account exists.
- `removeCredentialQuerySchema` and `revokeRecoveryCodesQuerySchema` are strict, so `DELETE …/credentials/{id}` now
  refuses an unknown query parameter with `400` where it used to ignore one. admin-paths says so.

### The docs footer, reworked

2026-10-19. The stock footer (dark rail surface, nine links in one column, a lone
"Project" column, a centred licence line) was taller than the content above it on
the image's home page at 2000 px. It is now one hairline-topped row on the page
surface (`--surface-panel`, `--border`, `--ink-muted`), content in the same
`.container` as the pages: the licence on the left, five links on the right
(Quick start, Reference, Security, Contributing, GitHub; `FOOTER_ROUTES` in
`nav.ts`). Configuration and CSS only, no swizzle, no inline style. Under 997 px
the licence drops below the links; at 576 px the links are a two-column grid with
44 px targets (32 px on a desktop; WCAG 2.2 asks for 24). GitHub carries
`rel="noopener noreferrer"` and a visually hidden "(opens in a new tab)", written
as a footer `html` item because the theme's own icon has an `aria-label` on an
`svg` with no role, which a screen reader may skip.

![The footer before, desktop dark](p4g-docs/footer-before-desktop-dark.webp)
![The footer after, desktop dark](p4g-docs/footer-after-desktop-dark.webp)
![The footer before, phone light](p4g-docs/footer-before-phone-light.webp)
![The footer after, phone light](p4g-docs/footer-after-phone-light.webp)

- **The year is the build's.** `© {new Date().getUTCFullYear()}` is computed in
  `docusaurus.config.ts`. A build after New Year changes it, and the turbo cache
  keys (`@odudu/docs#build` inputs and `env`) do not include the date, so a
  cached build from December survives into January until a source file changes.
  turbo's `env` takes names, not expressions, so the year cannot be made an input
  without a wrapper that exports it; not done. A cache hit can therefore carry the
  previous year. `tests/footer.test.ts` fails on a stale
  build, which is the signal to rebuild.
- **Tests.** `tests/footer.test.ts` (both builds: footer on every page, year,
  link targets exist, repository link attributes and cue, no `style` attribute,
  no hosted address in the image) and `tests/footer.browser.test.ts` (axe on the
  footer in both targets and both schemes, home and a docs page; no horizontal
  scroll and 24 px targets at 1440, 768 and 390; surface equals the navbar's).
  `axe-core` and `@axe-core/playwright` 4.13.0 became docs devDependencies, the
  versions the console already pins.
- verified: `pnpm --filter @odudu/docs build:image`, `build:pages`, then
  `test` (209 passed) and `test:browser` (19 passed, the image CSP walk
  among them); screenshots by Playwright Chromium at 1440, 768 and 390, light
  and dark, home and `/reference/`.

## The mail shell

2026-10-19. Every mail was `<p>` tags and a link: the owner's complaint was that it
looked nothing like the pages or the console. Every mail kind now goes through one
shell, `renderShell` in `packages/email/src/service/shell.ts` (verification, password
reset, required-actions link, the second-factor-removed and recovery-codes-revoked
notices, the SMTP test). A grep of the six `render…` names finds every call site, and
`outboxRepository(...).enqueue` and `sender.send` are the only two doors a message leaves by.

- **Layout.** Presentation tables (`role="presentation"`), 560px at most, a ghost table for
  Outlook's Word engine, `table-layout: fixed`, every style inline, a system font stack
  with no family name that contains a space (the server literal lint reads one as a
  sentence), no script, no remote stylesheet, no `url()`, no web font. A name or an address
  with no break opportunity wraps (`overflow-wrap: anywhere`) instead of widening the page:
  checked in Chromium at 600, 375 and 320px for every kind, including a 300-character name.
- **Header.** The tenant's display name beside the Odudu mark (controller ruling: the
  tenant is the sender identity; `odudu` is a quiet signature). Powered-by and the year are
  in the footer, as muted text with no link. The mail does not name a client: no flow that
  sends a mail carries one today, so there is nothing to put in a body.
- **Button.** The label comes from the catalogue (`Verify email`, `Reset password`,
  `Update account`); the padding is on the cell (12px 24px around a 20px line is 44px),
  with `mso-padding-alt` for Outlook, no VML. The same address is written out under it in
  a monospace box, `word-break: break-all`, as an anchor with the whole link; the
  plain-text part has the link on a line of its own. A link that is not an absolute
  `http(s)` URL is refused (`RangeError`), so `javascript:` cannot reach an `href`; the check
  lives in `renderShell` itself and also refuses credentials in the URL, surrounding whitespace
  and control characters. `+` and `%2F` in a link reach the href, the shown text and the
  plain text unchanged (`shell.test.ts`).
- **Footer.** The reason the mail was sent, per kind, then `© {year} Odudu · Powered by
odudu`. The year is the UTC year of an injected `now`, required everywhere (the account
  usecase and route deps, `ActionLinkTenant`, the credential-notice input, the SMTP test
  message; `systemClock` is passed only at the composition root). Tested with a fixed clock
  at 2026-12-31T23:59:59Z, 2027-01-01T00:00:00Z and 2031-06-01 against the queued row's
  footer year for verification (`verify-email.int.test.ts`), registration and reset (through
  their routes, `register.int.test.ts`, `reset-password.int.test.ts`), required actions
  (`execute-actions.int.test.ts`), `deleteCredential`, `revokeRecoveryCodes` and
  `enqueueCredentialNotice` (`recovery-lifecycle.int.test.ts`) and `sendTestMessage`
  (`smtp.test.ts`); replacing `now` with `new Date()` in each of those usecases fails its test.
  What is not tested: the protocol-admin routes' own `now: deps.now()` argument. A token
  minted on a fake clock is refused by the server, so a year cannot be forced through
  HTTP there; typecheck is what holds it (the input requires `now`). The plain-text part ends
  the same way after a `--` line.
- **A retried mail keeps the year it was queued in.** The markup is rendered when the row is
  written, not when it is sent, so a message retried after New Year says the year it was queued.
- **Preview text.** A hidden first element of the body (`display:none`, `max-height:0`,
  `overflow:hidden`, `mso-hide:all`, page-coloured, then a run of zero-width and no-break
  spaces so the client does not append body text), one sentence per kind from the catalogue
  (`*.preheader`), escaped like any text and naming no tenant.
- **Size.** A rendered message is about 5.8 KB (the same in the outbox row, which stores the
  markup, and over the wire). The display name shown in the mail is cut to 80 code points and an
  ellipsis before anything is escaped, so a 10,000-character name adds nothing (tested at 10,000
  in `shell.test.ts`, under 14 KB a message). `loggingSender` logs the text part and the markup's
  byte count, `htmlBytes`, never the markup. At the phase spec's scale the outbox holds
  one such row per mail not yet reaped, which is the reap's retention to bound, not the shell's.
- **Escaping.** Unchanged and extended to the shell: every value through `escapeHtml`, the
  tenant in `<bdi>`, FSI/PDI in text, nothing that can start a line in the subject. The
  link is now escaped in the markup (it was inserted raw) and stays raw in the text.
  `templates.test.ts` and `shell.test.ts` run the hostile-name cases (script, bidi
  controls, CRLF, a long name, an RTL name, emoji) over every kind.
- **Colours.** `packages/email/scripts/generate-assets.ts` compiles the tokens to hex
  (`palette.generated.ts`, from `apps/admin-console/src/shared/view/tokens.css`) and
  draws the mark. `palette.test.ts` fails when the committed palette is not what the
  tokens compile to, and `shell.test.ts` fails on any colour in a mail that is not in it
  (no `rgb()`, `var()` or `light-dark()`). `palette.test.ts` also holds the text pairs to 4.5:1
  in both palettes: the console's own pairs, with the button on `--ink-primary`, as the
  server pages' buttons are.
- **The mark.** A 80x80 PNG (shown at 40x40), the staff in `--ink-rail` on a `--surface-rail` rounded
  tile with a 1px ring in `--ink-rail-muted` (a mid tone that shows on the light page and on
  the dark one, where the tile alone was nearly invisible), so one image reads on either palette. It is rasterised from `mark.svg` by a small
  anti-aliasing drawer in the package (`mark-png.ts`; the committed bytes are compared pixel for
  pixel with a fresh drawing, not byte for byte, so a different zlib cannot fail it).
  It travels as an inline `cid:odudu-mark` part: `smtpSender` adds the attachment to any message
  whose markup names it, so a self-hosted install needs no public asset URL and nothing is fetched
  when the mail is opened. `alt="odudu"` shows where images are blocked.

verified: `node_modules/.bin/vitest run --project integration packages/email/tests/smtp.int.test.ts`
(Mailpit v1.31.5: the message arrives with one inline part, `ContentID` `odudu-mark`, `image/png`), and on the stack
`odudu-p4g-mail` a tenant relay at a Mailpit container delivered the required-actions mail, whose
Mailpit page (`/view/<id>.html`) drew the shell with the mark.

### What the clients do, and what degrades

Relied on, from the clients' documented behaviour and not tried in them (only Chromium was
run here, on the real messages and on Mailpit's rendering): table layout and inline style
everywhere; `<style>` in the head, which Gmail (web and apps), Apple Mail, Outlook 2019+/365
and Yahoo keep and old Gmail variants and some webmail strip; `max-width` on a table, which
the Word-engine Outlooks ignore, hence the ghost table; padding on a cell, which every client
honours, where padding on the anchor is ignored by the Word engine.

Dark mode is partial. A client that reads `prefers-color-scheme` (Apple Mail, iOS Mail,
Outlook for Mac and the new Outlook, Thunderbird, Fastmail) gets the dark palette. Gmail's apps
darken a light mail by inverting its colours themselves, so the light palette is what they
transform; the Outlook.com and Outlook-on-Windows dark modes rewrite colours too and may
differ from the palette. A client that does neither gets the light version, which is the one
every text pair is checked against and is fully readable. The corners round in clients that
honour `border-radius` and are square in the Word engine. The mark's tile is dark in both
schemes and carries a mid-tone ring, so it needs no variant.

Per-tenant mail theming (the tenant's own colours and logo in the shell) stays with **P4b**,
whose criterion already names the verification and reset mail rendered under a tenant's theme;
the shell takes its colours from one palette object, which is what that phase replaces.

### Mail gallery

Chromium, every kind rendered by `packages/email/scripts/preview.ts` (the inline mark swapped for a
data URI so the file opens alone), light and dark, 600px and 375px, cropped to the message.
The gallery holds twelve of the thirty-two views; the rest were looked at.

- ![verification, light, 600px](p4g-mails/verification-light-600.webp) `verification-light-600`: the verification mail.
- ![verification, dark, 600px](p4g-mails/verification-dark-600.webp) `verification-dark-600`: the same, the dark palette.
- ![verification, light, 375px](p4g-mails/verification-light-375.webp) `verification-light-375`: the same at phone width.
- ![verification, dark, 375px](p4g-mails/verification-dark-375.webp) `verification-dark-375`: dark, phone width.
- ![password reset, light, 600px](p4g-mails/password-reset-light-600.webp) `password-reset-light-600`: the reset mail.
- ![required actions, light, 600px](p4g-mails/required-actions-light-600.webp) `required-actions-light-600`: the required-actions link with its list.
- ![required actions, dark, 375px](p4g-mails/required-actions-dark-375.webp) `required-actions-dark-375`: the same, dark, phone width.
- ![second factor removed, light, 600px](p4g-mails/factor-removed-light-600.webp) `factor-removed-light-600`: the notice, no button and no link.
- ![recovery codes revoked, dark, 600px](p4g-mails/recovery-revoked-dark-600.webp) `recovery-revoked-dark-600`: the other notice, dark.
- ![SMTP test, light, 375px](p4g-mails/smtp-test-light-375.webp) `smtp-test-light-375`: the SMTP test mail.
- ![a very long tenant name](p4g-mails/verification-long-name-light-375.webp) `verification-long-name-light-375`: a 192-character name, cut at 80 characters and an ellipsis.
- ![a right-to-left tenant name](p4g-mails/verification-rtl-light-375.webp) `verification-rtl-light-375`: an Arabic name in an English mail, isolated.

What the first look found and was fixed: a long name with no break widened the page past the
phone (every text block now wraps anywhere), the footer sat 4px inside the card's edge, the
mark was small in its tile, and in the dark palette the tile's edge was invisible against the page (now ringed).
The wrap of an unbroken run is held by `shell.test.ts` and was looked at before the name cap made the sample shorter.

## Increment 22: the path documents in the site

`request-paths`, `admin-paths` and `console-paths` now exist twice: as the three
originals, and cut by section into `apps/docs/content/en/reference/protocol/` (24 pages and an
index), `reference/admin-api-paths/` (70 and an index) and `admin-console/paths/` (20 and an
index). "What is not implemented" stays in `request-paths` until the roadmap page takes it, so
the protocol pages are the guide without that list. The tests read the pages
(`loadPages` in `tests/docs/markdown.ts`, which gives back the one document the pages were cut
from, with `at(document, line)` citing `page:line`); `tests/docs/split-preserves-the-documents.test.ts`
holds every line of each original, in order, against its pages. Only page boundaries, front matter,
link targets and the padding of a table row may differ.

The split was a one-off script kept out of the tree. Its three rules: cut at each `^## ` outside a
fence, name the page by the heading's slug (at most 80 characters), and give it a `title` and a
`description` (the first sentence of its first paragraph, 50 to 150 characters); then retarget every
Markdown link, with `github-slugger` for the anchors, to the page that now holds the heading, or to
`https://github.com/wizzywit/odudu/blob/main/...` for a file the site does not hold. No prose was edited.
A line that carries bare HTML outside a fence or code span would have been listed for a human: there
were none. verified: `node --no-warnings <script>.ts`, then `prettier --write` on the three directories.

- **Build.** `pnpm --filter @odudu/docs build:pages`: 9 s with `generate` and `docusaurus clear`.
  Largest page, `protocol/path-a-authorization-code-with-pkce`: 370,504 bytes of HTML (41 KB gzip),
  against 1.37 MB unsplit; the largest admin page is 119 KB. Largest content chunk 29 KB gzip
  (157 KB unsplit). First load of that page is the runtime (5.6 KB) and `main` (168.8 KB) plus the
  chunk: about 203 KB gzip, 3 KB over the 200 KB figure the landing and docs pages were held to
  before the search index and these chunks, so the budget needs a decision where it is enforced.
- **Fenced blocks.** `apps/docs/tests/transcripts.test.ts` compares every fenced block of every page
  with the `<pre>` text of the built page (`.token-line` rows joined by a newline), in both targets:
  all of them identical. Changing one space in a source block fails it.
- **A page's first heading is its title only when that is lossless.** A heading with no markup and at
  most 60 characters becomes the page's `# `, and its sub-headings move up a level (`loadPages` moves
  them back); a link to that heading is a link to the page, because Docusaurus gives an `h1` no id.
  Every other page keeps `## `, with a plain `title` under 60 characters. The agent-copy plugin drops a
  duplicate title heading only when it matches the title exactly and holds no inline code, so a
  promoted heading with backticks left two copies of it in the Markdown copy.
- **Front matter has limits the site tests set.** A description is 50 to 150 characters and unique:
  the llms plugin cuts at 150 and the copy test compares the description it prints with the page's, and
  no `://` may appear in it. A title is at most 70 characters and unique across the site; four needed
  an override (two `The shape of it` and `What to do next` headings, two console refusals).
- **`agent-links.ts` did not rewrite a link whose text holds inline code or wraps a line.** Both are
  everywhere in the moved pages, and the copies kept `./page.md` links that resolve nowhere. It now
  blanks code spans instead of cutting around them and no longer needs the `[` on the same line
  (`agent-links.test.ts`, one row for each form, each failing before the change).
- **`csp.test.ts` read `style=` out of escaped text.** A transcript shows markup, and the raw reader
  took ` style=` in its text for an attribute; it now reads attributes inside tags only. The CSP
  script, which parses, was right: 9 style-attribute hashes before and after.
- **`links.test.ts`** exempts the three transcript directories from "no absolute `/docs/` path": they
  record the server's own `/docs` route, which is not an address on this site.
- **Sidebar.** Each directory is a category (`Request paths`, `Admin paths`, `Console paths`) under
  its section, expanded, because a collapsed category renders its children lazily and a page three
  clicks from home fails the information-architecture walk. The section pages link to the index of
  each. The category labels equal the indexes' `h1` because the breadcrumb ends at the label.
- **Left for the roadmap page.** `request-paths#what-is-not-implemented` is linked from seven pages
  as a repository URL. `phase-references.test.ts` reads both the pages (floor 4) and the original
  (floor 20) until the list moves.

## Increment 22b: the documentation as a story

Owner feedback on the migrated pages: heavy navigation, no order, contributor prose on reader pages.
The three transcript directories moved under Reference, and the site gained the journeys an adopter
reads first.

- **Layout.** `reference/protocol`, `reference/admin-api-paths` and `admin-console/paths` became
  `reference/transcripts/{request-paths,admin-paths,console-paths}`, with a `Transcripts` page above
  them. The three groups are collapsed in the sidebar, so a route list never sits in the navigation;
  the Reference page links the three group indexes, which list every page in `order.json` order
  (`tests/journeys.test.ts` holds the lists to the orders). Every relative link was re-resolved by
  script; no prose in a transcript changed except as below.
- **Sidebar by reader goal.** Start here (Introduction, Quick start), Guides, Concepts, Admin console,
  Operating Odudu, Reference, Security, Contributing. `SECTION_ITEMS` became `SIDEBAR_ITEMS`; the
  section labels and `SECTIONS` are as before, and the sidebar does not rename Operating Odudu to
  "Run it" because the breadcrumb ends at the page's own title. A `sidebarItemsGenerator` drops a
  directory's `index` from its category's items; without it the guides listed "Guides" as their last
  child.
- **Journeys.** `guides/` holds four pages in second person: `sign-a-user-in`,
  `refresh-and-end-a-session`, `admin-signs-in-and-changes-a-user`, `read-a-refusal`. Each step is a
  `##` with a goal sentence or two, one excerpt and a link to its full transcript.
  `tests/journeys.test.ts` fails when an excerpt is not a substring of a fenced block on a transcript
  page the same step links, when a step with an excerpt links none, and when an excerpt passes 24
  lines. The excerpts were cut from the transcripts by a script that slices lines, never typed.
  The console journey draws on three runs (ports and ids differ between steps) and says so.
- **Contributor prose.** The opening of each original document (how and on which stack it was
  captured) moved verbatim to `contributing/transcripts.md`; each group's `index.md` is now written for
  a reader. `split-preserves-the-documents.test.ts` compares each original after its opening with the
  pages after their index, and holds the opening to the contributing page in order. **Still in the
  transcript bodies:** "recaptured on..." and run-provenance sentences inside individual pages, and
  repository paths in prose. They are the transcripts' own record and the original documents still
  carry them. Done in Increment 23.
- **One heading per page.** 67 route pages had a plain `title` rendered as `h1` and the same route as
  a code `h2`. Where the heading is at most 60 characters its page now opens with it as the `# ` (its
  sub-headings moved up one level, as `loadPages` already allows) and the title is its text without
  the code marks; 32 links to such a heading became page links. The long multi-route headings and the
  two duplicate-titled admin pages keep the old shape. `agent-title.ts` drops, from a page's Markdown
  copy and its section of `llms-full.txt`, a repeat of the title that differs only by code marks
  (`agent-title.test.ts`, failing before `dropRepeatedTitle` existed).
- **Home.** `HomeMap` replaces `SectionGrid`: Quick start as the one primary card, the four journeys
  numbered, the other sections as a quieter grid. Both the image's home and the landing use it.
- **Code blocks.** A block's background is `var(--code-surface)` so a shadow can fade into it, and
  the edge with more to scroll carries one (`background-attachment: local` over `scroll`); route
  headings in the contents list wrap instead of being clipped.
- **Stub pages.** Introduction, Quick start, Guides, Concepts and the console page keep their
  `filled by` markers but open with a real outline built only from what exists today.
- **`ia.test.ts`, changed on purpose.** The sidebar-order test reads `concepts/index.html`, where
  every category but Start here is collapsed, instead of `guides/index.html`, where the guides expand.
  The reach walk allows one more click (home, Reference, group index, page) for pages under
  `reference/transcripts/` only. New: the guides' sidebar lists the four journeys in order, the
  Reference page's sidebar names no transcript page, and the home links every journey.

Before and after, light and dark, 1280 px and 375 px (the try stack's pages are the "before"):

![Home, before](p4g-docs/22b-before-home-desktop-light.webp)
![Home, after](p4g-docs/22b-after-home-desktop-light.webp)
![Console path, before](p4g-docs/22b-before-console-desktop-light.webp)
![Console path, after](p4g-docs/22b-after-console-desktop-light.webp)
![Reference, before](p4g-docs/22b-before-reference-desktop-light.webp)
![Transcripts, after](p4g-docs/22b-after-transcripts-desktop-light.webp)
![A journey, after](p4g-docs/22b-after-journey-desktop-light.webp)

The other variants are `p4g-docs/22b-{before,after}-{home,console,reference,transcripts,journey}-{desktop,phone}-{light,dark}.webp`.

## Increment 23: the roadmap page, the citations, the retirement

- **Roadmap.** `apps/docs/content/en/roadmap.md` holds the "What is not implemented" list and the
  P4d gap-audit list, with a note that the hosted service is planned and unscheduled (ADR 0042).
  Read against the phases that closed: every marker still names an open phase or a decision. One
  line was corrected (translated pages and mail: the catalogue mechanism exists, P4b ships the
  locales, P4h the console's catalogue). "No published image or release process" stays under P4g
  because no image has been published yet. The page sits in the Reference category of the sidebar,
  is linked from the introduction and the reference index, and is two clicks from home.
  `not-implemented-placement` and `gap-audit-placement` read it; `phase-references` holds it to 49
  citations, the protocol pages to 4.
- **Retirement.** The three path documents under `docs/` (request, admin and console) are deleted. 50
  files outside `docs/archive` cited them; each citation now names the page (README, ADRs, phase
  and protocol notes, source comments), with heading anchors resolved through the headings of the
  original against the pages (github-slugger) rather than typed. `retired-documents.test.ts` fails
  on any citation of a retired path outside the archive and on the files existing.
- **What replaced the split test.** `split-preserves-the-documents` compared every line of each
  original with its pages and has nothing to compare with now. `transcript-pages.test.ts` keeps
  its order, front-matter, Markdown-only and repository-link checks, adds a floor per group on
  fenced blocks (656, 616, 161), and keeps the capture-notes page to one section per group.
  `apps/docs/tests/transcripts.test.ts` still holds every fenced block to the built page. The
  floors of `references.test.ts` (protocol pages: repository paths 5 to 4) moved with the prose
  that no longer names a path.
- **Link check.** `lychee` is not installed here and was not downloaded, so the heading-anchor half
  of the brief is `tests/docs/link-fragments.test.ts`: every link with a `#fragment` into a Markdown
  file outside the archive and the generated reference must reach a heading, with a site page's
  `h1` carrying no anchor. Its first run found no dead anchor in the moved pages; a scratch file
  with a broken anchor failed it. File-level links were already held by `references.test.ts`.
- **Transcript pages for readers.** Run provenance and source paths are gone from the prose of the
  three groups: ordinal stacks, compose project names, commits, "captured against", "From the
  seventh run", and 150 sentences naming `packages/...`, `apps/...` or `tests/...`. Fenced blocks
  are byte-identical (checked per file against HEAD). Front matter descriptions that carried the
  provenance were rewritten. `transcript-pages.test.ts` fails on any of these patterns in prose; it
  was shown to fail on a planted line. `contributing/transcripts.md` keeps the stack notes.
- **Placed: Increment 36a (the whole-docs reading pass).** The 18 pages whose long multi-route
  heading stays an `h2` under a short `title`. The choice is the breadcrumb: the last crumb must
  equal the `h1`, so either the long heading becomes both, or the heading is shortened to the title
  and the routes move into the first paragraph. Listed in the plan's Task 36a.
- **A rule softened on purpose, then restored.** The first retargeting of CLAUDE.md traded "name the
  stack it was captured against" for "say what had run before it", and the page test banned
  "captured on/against". The rule is back at full strength: a transcript whose output depends on
  earlier state names the stack in words a reader can reproduce; the page test bans a date, a run, a
  compose project, an ordinal stack and a commit, not "captured against a stack driven only as far
  as Path A".
- **Fix round.** `references.test.ts` already failed on a dead relative link in every Markdown file
  outside generated output, the archive included; it now also pins that its document set holds
  README, CLAUDE, NEXT, the ADRs, phase notes, specs, the archive and the site source. Source
  comments cite the page, not the directory. NEXT's localization row and sentence say the catalogue
  mechanism exists and name what P4b and P4h still own.

## Increment 24: the introduction, the quick start and the integration guides

- **Pages.** `introduction/{index,odudu,compare}`, `quick-start`, and in `guides/` the web app, the
  single-page app, the API, the service and Keycloak guides. The introduction's two sub-pages sit in a
  collapsed category under Introduction so they have a sidebar and a breadcrumb (`seo-html.test.ts`
  requires both of every docs page). `compare.md` links no site outside the repository, because the
  image build allows no anchor to another origin (`csp.test.ts`); the four projects are named in a
  table that says "see their documentation".
- **Runnable.** 59 commands carry `sh {run}`; `MINIMUM_BLOCKS` is 59. `docs-commands.yml` runs the quick
  start before the guides, since it makes the `demo` tenant and `ada`, and exports `COMPOSE_FILE` (an
  absolute path) and `COMPOSE_PROJECT_NAME` so `docker compose exec odudu ...` in a guide finds the CI
  stack as it finds a reader's. `quickstart/stack.sh` unsets `COMPOSE_FILE` because it runs in its own
  directory. verified: `quickstart/stack.sh up odudu-p4g24:latest 3195` on a fresh volume, then
  `node tools/docs-run/src/index.ts apps/docs/content/en/quick-start apps/docs/content/en/guides`:
  `59 runnable blocks, 0 failed`.
- **Found while running them.**
  - `docker compose exec odudu odudu seed ...` failed on the quickstart stack: its configuration is
    `quickstart.env` on the state volume, read through `node --env-file=` by the server's own command, not
    in the container's environment. `infra/docker/odudu` now loads that file when it exists, and sets
    `NODE_NO_WARNINGS` so a command's output is not led by two experimental-API warnings
    (`tests/lint/odudu-shim.test.ts`).
  - `docker compose exec` reads standard input, so a block that ran it swallowed the rest of the session's
    script. The runner gives each block empty standard input (`session.test.ts`).
  - `seed client --client-secret` with no `--redirect-uri` surfaced the CHECK
    `client_oidc_config_redirect_uris_present` as a raw database stack trace. It is now
    `seed_invalid_options` naming `--redirect-uri` and the `--grant-type client_credentials` alone that a
    service client uses (`seed.int.test.ts`).
  - The seed examples for `--group` read `staff`, which the command refuses (`no group at path "staff"`):
    a group is addressed by its path, `/staff`. The registry examples, and so the generated command
    reference, now say so (`registry.test.ts`).
  - The runner ignored an attribute it could not read: an `expect=` without quotes asserted nothing.
    `extractRunnable` now refuses it. Prettier also rewrites a backslash-escaped quote in a fence's info
    string, so no `expect` text holds a double quote.
- **Not written, and placed.** The "Protect an MCP server with Odudu" guide. verified: `curl
$ODUDU_BASE/.well-known/oauth-authorization-server/tenants/demo` answers 404 and the demo tenant's
  discovery document names no `registration_endpoint`. The RFC paths: `curl -sS
https://www.rfc-editor.org/rfc/rfc8414.txt | grep -m2 oauth-authorization-server` and the same on
  `rfc9728.txt` with `oauth-protected-resource`. The gap is a roadmap item under P5a (the MCP authorization
  profile and this guide), and design spec section 11's P5a row now says the guide is written against the
  passing profile instead of being a P4g deliverable. A guide for behaviour the tenant lacks would show
  nothing that runs.
- **Roadmap claims.** SCIM inbound provisioning and moving more than 10,000 subjects were placed in the
  design spec (P7) but missing from the roadmap page; pages said the roadmap named them. The P7 item is
  on the page, and `tests/docs/roadmap-claims.test.ts` fails when a sentence about the roadmap names a
  listed capability the page does not (the list of terms is short; add one when a page first uses it).
- **Left for the example applications.** Each integration guide ends at a working sign-in done with
  `curl`, playing the browser. The example application of its kind arrives with the increments that build
  them and adds its section to the guide.

## Increment 24b: the quick start through the console

- **Tabs.** `quick-start/index.mdx` (the first `.mdx` page) gives each setup step a Console and a Command
  line tab, `groupId="route"`, the console first. The command-line tabs are the runnable blocks as
  before (59, run by docs-run). The llms plugin already turns tabs into bold labels and drops components;
  `plugins/agent-mdx.ts` drops the import lines it leaves, `llms.test.ts` fails on an import or component
  tag in an `.mdx` page's copy, and the copy keeps no screenshot. A fence inside a tab sits at column 0
  between blank lines, which `extractRunnable` reads unchanged.
- **What the console does differently.** It cannot choose a person's password: `POST /subjects` writes an
  `update-password` action by rule, and the Credentials tab issues a one-time password. The page says so in
  one sentence and the roadmap places it as a decision. Creating a tenant is two steps in the console (the
  tenant, then its first administrator); the tenant exists after the first, which the page states. The
  console's sign-in first asks which tenant you administer (`system`), which the old page never said.
- **Names.** Every bold name on the page must be defined in the console's sources or the sign-in
  messages (`console-labels.test.ts`; a template such as `Enter ${name}` defines "Enter demo").
- **Captures.** `pnpm docs:screenshots` (`apps/docs/scripts/console-shots/`): `screens.ts` is the list a
  later page extends; `capture.ts` signs in as the stack's administrator (`ODUDU_BASE`,
  `ODUDU_ADMIN_EMAIL`, `ODUDU_ADMIN_PASSWORD`, so a generated, not yet changed password is refused),
  creates `demo`, `my-app` and `ada` through the console itself when they are missing, checks each
  screen's expected headings and controls, and writes a light and a dark WebP (Chromium's canvas encodes
  them) with `manifest.json` to `static/console/`. `guard.ts` refuses a capture that shows the given
  password, a filled password field, a dialog saying "the only time ... is shown", or a banner password
  line. `ConsoleShot` shows the capture of the page's theme, sized, lazy, with alt text and a caption;
  `console-shots.test.ts` ties pages, screens and files together. verified: a run against the quickstart
  stack on port 3195 wrote 16 files, twice (the second run found the data and skipped creating it).
- **Not done.** The guides' own registration steps stay command-line only, and the capture is not yet a
  CI job (the tour increment wires it, with the e2e stack).
- `.webp` joins the types the docs route serves (`DOCS_TYPES`).

### Increment 24b, fix round

- **Names.** `console-labels.test.ts` is a table: each bold name on the page, the one console file that
  renders it and the exact text there; a template (`Create ${noun}`) lists the file that binds each part and
  is expanded, with no wildcard. A name not in the table fails; a console label renamed fails (mutation
  checked with `label="Kind"` renamed, and with "Create a widget" on the page).
- **Capture safety.** The guard now scans all text nodes (hidden ones too), every attribute value and every
  field for the given strings, a token with the length and alphabet of a generated secret (mixed case, a digit,
  few hyphens, UUIDs removed), the shown-once sentence anywhere, and the banner line; it is given the admin
  password and any admin username other than the published default. The rail's "Signed in as" is rewritten to
  the published default, the stack's origin to `http://localhost:3000`, and every time to "just now". The
  secret-issuing requests (`POST .../subjects/{id}/password`, `.../clients/{id}/secret`) are aborted and fail
  the capture; a run that clicked **Issue password** failed with the request named (mutation checked), a
  guard with the token rule removed failed its test, and a token appended to a record failed
  `console-shots.test.ts`. The run refuses a host other than this machine, and the lists must hold exactly
  `odudu-admin` and `my-app`, and `ada`.
- **A record beside the images.** `record/<screen>-<theme>.txt` holds the text each page held, committed, and
  scanned by a test for the shapes above, for the rows and for the published origin.
- **Not byte-identical.** Two captures of one screen differ in a few pixels from run to run (a flake of one
  to three of sixteen images in repeated runs; a settle wait, `animations: 'disabled'`, a hidden caret and
  a moved mouse did not remove it, the last made it worse). The records are identical, so `--check` compares
  records and the manifest, and says so.
- **Minor, not done.** A narrower viewport for larger text on screen (the images are 1100 px wide in a column
  of about 750; a smaller capture changes every layout and every alt text, left for the tour increment, which
  owns the capture and its CI job); no-JavaScript readers see the first tab only, and a dark-OS reader without
  JavaScript sees the light image (standard Docusaurus tabs; the agent copies carry both routes).

## Increment 25: the seven concepts

- **Pages.** `concepts/` holds an index and seven pages (tenants, clients, scopes, roles and groups, sessions, tokens,
  consent and audit), each a short story, a diagram, the rules and a numbered "Working with" list. The concepts
  sidebar entry is now a directory of the seven. "Recovery codes" is a section of the sessions page, because a set is
  what stands in for a second factor at sign-in; it states one set per person (ten codes), a code that stands in for a TOTP
  code and never follows a passkey, whole-set revocation with the audit action when the last TOTP goes, and the admin
  revoke with `require_new_set`.
- **Diagrams.** `src/components/Diagram/` draws each diagram inline as React SVG, so it sits in the page's own tree and
  every colour is one of Instrument's custom properties (`--surface-sunken`, `--signal-active`, `--ink-primary`, ...), which
  follow the site's colour toggle, not the system setting. (A first version used standalone SVG files through `<img>`, which
  cannot read the page's properties and followed only the OS scheme.) The seven concept pages became `.mdx` to import it:
  `<Diagram name title desc />` followed by an italic "In words" paragraph repeating `desc`. The llms plugin drops the
  component and keeps the paragraph, so a Markdown copy carries the description and no drawing. Colours are presentation
  attributes (`fill="var(--...)"`), so no `style` attribute reaches the policy's hash inventory, and the diagrams need no
  asset, data URI or CSS file but a two-rule module. Every diagram is one portrait 340-unit viewBox, nodes stacked
  vertically, text 13 to 15 units, shown at most 22rem wide, so text renders at 13 to 14.5 px on a 375 px phone.
- **Alt text.** Not applicable now: the text alternative is the SVG's own `<title>` and `<desc>` through
  `aria-labelledby`, equal (tested) to the page's props.
- **Checks.** `apps/docs/tests/concepts.browser.test.ts` (built site in Chromium, theme changed with the site's toggle
  while the system scheme says the opposite; on a phone through the menu's toggle): the computed contrast of every text
  against the surface it sits on is at least 4.5 and of every arrow against the page at least 3, every text lies inside its
  drawing, the rendered text is at least 12 px at 375 px, nothing scrolls sideways, and axe finds no violation, for all
  seven pages, light and dark, phone and desktop. `apps/docs/tests/concepts.test.ts`: structure, word count (400 to 900),
  one `<Diagram>` per page with the title and description in the built `<svg>` and the description in the Markdown copy,
  the component's source carrying no hard-coded colour, `style` or link, every stated number
  against the migration or constant that sets it (`FACTS`), and every code-font name that looks like a setting, claim or
  action against the sources. `tests/docs/concept-claims.test.ts`: every `METHOD /path` a page names against the
  server's router, the consent decision against `decideConsent`, the recovery rules against `recoveryApplicable`, and the
  refusal budget against its constant. The server-importing half lives in `tests/docs` because `apps/docs/tsconfig.json`
  cannot typecheck the server's sources. Mutation checked: a stated default changed on a page, and a route renamed.
- **Screenshots.** `docs/phases/p4g-docs/concept-sessions-*` and `concept-tokens-*`, desktop and 375 px, light and dark.
- **Sidebar test.** `ia.test.ts` read the section list from the concepts page; with the concepts opened it now reads it
  from the quick start and asserts the seven pages beneath concepts in order.

### Increment 25, fix round

- **Refresh tokens and sessions.** The sessions page said ending a session ends the refresh tokens it issued. Only a
  session-bound family does (`refresh-rotation.ts` checks the session when `grant.sessionId` is set); a grant made with
  `offline_access` has none, is bounded by its own lifetime, and ending sessions leaves it alone. The page now says so and
  names the two admin calls that exist today, `GET` and `DELETE /admin/tenants/{tenant}/subjects/{id}/grants[/{clientId}]`,
  which list grants with an `offline` flag and revoke a client's grants, offline ones included, without ending a session.
  No roadmap entry is needed: the way exists. `concept-claims.test.ts` holds both the rotation rule and the revoke route.
- **Contrast is measured where the text is drawn.** The browser test no longer trusts an author's `data-on`; it takes the
  smallest drawn rectangle that holds a text's whole box (or the page), reads that rectangle's computed fill, and fails a
  text that is only partly over a box or outside the viewBox. Mutation checked: one box filled with the ink colour fails
  "Users" at contrast 1; a text moved between two boxes fails as "only partly over a box".
- **Diagram changes.** The SVG names itself by `aria-labelledby` (the title) and describes itself by `aria-describedby`
  (the desc). The sessions diagram now shows a quiet stretch longer than the idle limit ending the session; the clients
  diagram labels the arrows with the code, verifier and secret that make the hop; the tokens diagram joins its three cards
  with a bracket. Diagrams may draw 30rem wide on desktop (text renders about 1.4 times the phone size).
- **Wording.** The roles claim writes a client role with its client in front (`reports-api:reader`, from
  `qualifiedRoleName`); the unsourced "cannot lock you out" rationale is gone from the tenants page; the audit page points
  at the generated configuration and command references for the retention schedule instead of the Operating section
  (Increment 27's plan names configuration and deploying pages, not the retention schedule, so the page does not rely on it).
- `resolveTarget` in `references.test.ts` is removed (no site-root link remains); the code-font name check now needs the
  full name, except a field named through `settings.`.

## Increment 26: the admin console tour

- **Pages.** `admin-console/` holds the index, `tour.mdx` (a guided first visit: sign-in, tenants, entering a tenant,
  the menu, one person, the audit trail, sign-out) and one `.mdx` per area: overview, subjects, groups, roles, clients,
  scopes, registration-tokens, sign-in-flow, signing-keys, sessions, settings, email, audit-trail, tenants (with
  export and import) and system-administrators. Each is a story: the goal, numbered steps with a light and dark
  capture, a section on what cannot be undone, and "Do the same through the API" as the last section. Titles read
  "X in the console" because four area names (Clients, Scopes, Sessions, Tenants) are also concept titles and the
  llms plugin cannot tell two pages of one title apart (`llms-full.txt section 17 is not Clients`).
- **Captures.** 17 screens added to `screens.ts` (25 in all, 50 images and records). The page text is made
  reproducible across stacks: ids become a numbered series, moments a fixed series, the public point of a published
  key is blanked, the browser runs in UTC. verified: `with-stack.sh --check` on a second fresh stack matched the
  records written on the first. The guard now lets the public members (`x`, `y`, `n`) of a published key through and
  still refuses a private one (`d`).
- **CI.** Job `console-shots` (needs `changes`, `if buildImage == 'true'`, in `gate`'s needs) builds the image,
  starts the e2e-style stack with `with-stack.sh`, signs in as the one administrator `odudu seed admin` makes (the
  required first-sign-in password change is stood in for by clearing `user_required_actions`) and runs `--check`:
  a missing heading, control or row, a secret on a page, or a text that no longer matches its record fails it.
  `ci-workflow.test.ts` pins the job, its condition, the gate and the image tag.
- **Labels.** The label table moved to `tests/support/console-labels.ts` (about 230 names, a name meaning several things
  lists each place a page uses it, whitespace read as one space). `console-areas.test.ts` ties every feature directory,
  menu entry, capability and tab to a page. `turbo.json` now lists the console sources among `@odudu/docs#test`'s inputs:
  before, a console rename could be a cache hit on the label test.
- **Descriptions.** The groups, roles, mail, smtp and whoami reference fields are written (the coverage table above);
  `to`, `sent`, `default` and `child_role_id` are common words because each body holds one field.
- **CLI beyond the console.** The four operator commands (`reap`, `send-mail`, `send-logouts`, `client-origins rebuild`)
  have no console button: placed on the roadmap as a decision under ADR 0024.
- **Not done.** The amend bodies (`PATCH` of a group, role, scope) are open records with no fields to describe.

### Increment 26, fix round 1

- **Operator commands.** The roadmap and the tour no longer call all four a scheduled pass: `reap`, `send-mail` and `send-logouts` are
  run by the server on its own schedule and can be switched off (`ODUDU_REAP_ENABLED`, `ODUDU_OUTBOX_ENABLED`,
  `ODUDU_LOGOUT_SENDER_ENABLED`); `client-origins rebuild` is run once after an upgrade. ADR 0024 covers `reap` only, and the pages say so.
  `console-areas.test.ts` derives the scheduled three from the configuration docs and refuses "schedule" in a sentence about `rebuild`.
- **`describeFields` refuses a field its schema lacks** (`fieldsMissingFrom`). It found three more strays besides the four pasted into
  the count response.
- **The guard missed long random keys with many hyphens**; the limit scales with length now. Tests for d, p, q, dp, dq, qi, a full private
  JWK and a public `n`.
- **A diagram that kept a cursor outside `draw`.** `sessions()` mutated an outer `x` while rendering, so the first draw was right
  and every later one (a second visit through the router, history back and forward) drew its segments off the viewBox. The static
  page and the first load looked right, which is why the browser test passed. Now: `diagram-purity.test.ts` draws every drawing three times
  and compares the elements (the others were already pure); `concepts.browser.test.ts` compares the page's texts, in order, with the
  texts the drawing declares, after hydration, after a router navigation, after back and forward and after a theme toggle, and fails on a
  text outside the viewBox. verified: with the outer `let x` put back, the unit test fails and the browser test fails with
  "sessions after coming back to it leaves the drawing". Captures: `docs/phases/p4g-docs/concept-sessions-diagram-desktop-*.png`.
- **Captures** are 1100x900 now, so the menu's "Signed in as" is whole; the signing keys shot starts at the page title.

### Increment 26b: the roadmap page for adopters

- **The page** (`apps/docs/content/en/roadmap.md`) is four parts: Shipped (grouped by capability), Next (the spec's order from P4g:
  P4g, P4b, P5a, P4f, P4h, P5, P5b), Later (P6 to P13, then the smaller capabilities each placed on a phase) and Decided against, and
  why. It cites no closed phase and cites P4g only as "this release".
- **Where the old entries went.** The full text of the previous page, from "What is not implemented" on, is
  `docs/phases/roadmap-reasoning-2026-10-20.md` (links rewritten to resolve from there). Entries with detail the new page drops, and
  where each is now: the `resource` reading (RFC 8707 query component) and the front-channel logout code path, the recovery-code
  re-issue cost, the `seed client` flag inventory, the 22-name claims registry and `entitlements`, the audit-reader list and the
  refresh-token retention argument are in that note; the decisions behind them stay in their ADRs (0016, 0020, 0021, 0024, 0037, 0043).
  Transcript pages that cited a roadmap row now cite the page's Decided against section or the note.
- **Tests.** New `tests/docs/roadmap-shape.test.ts`: the four headings in order; Next ordered as the spec's table orders it; every later
  phase in Later and none in both; no closed phase cited (closed = every phase before P4g in the spec's table), P4g only with "this
  release"; no dates or "used to"; and 50 phrases from the old page, each still said in an item that names the phase, decision or ADR
  the old page named. `not-implemented-placement.test.ts` now reads the Next, Later and Decided sections; `gap-audit-placement.test.ts`
  reads the heading "Smaller capabilities, each placed on a phase" (same twelve items, same check against the spec's criteria);
  `phase-references.test.ts` expects at least 30 phase citations instead of 49; `link-fragments` had thirteen links to the old anchor,
  repointed. `roadmap-claims` and `references` passed unchanged. Mutation: a closed phase cited fails the shape test; a placement
  reworded away ("DPoP") fails it.
- **Browser project.** `vitest.config.ts` gives the browser project the `@site` alias too (the concept browser test now loads the diagrams); once,
  the quick-start capture-loading browser test failed on a lazy-image race and passed on three reruns.

## Increment 27: operating, security, contributing

- **What was not there to copy from.** `RELEASING.md`, `release.yml` and `CHANGELOG.md` do not exist on this branch, so the deploying page
  cannot show a `cosign verify` command and says so; `operating/releasing.md` says no version is published. `operating.test.ts` copies every
  `cosign verify` line of `RELEASING.md` onto the deploying page once the file exists, and until then asserts the page shows none.
  `SECURITY.md` is not embedded either (no include mechanism in the site; Increment 33 rewrites it): `disclosure.md` carries only the private
  advisory address, and a test requires it to equal the one in `SECURITY.md`.
- **verified:** a deployment with a least-privilege owner. In a scratch network, `postgres:17-alpine`, `CREATE ROLE odudu_owner LOGIN CREATEROLE
BYPASSRLS`, `CREATE ROLE odudu_svc LOGIN`, `CREATE DATABASE odudu OWNER odudu_owner`, then the image with `ODUDU_DATABASE_URL`,
  `ODUDU_APP_DATABASE_URL`, a fresh `ODUDU_KEK`, `odudu console keygen`, `ODUDU_PUBLIC_BASE_URL=https://id.example.test`, `ODUDU_TLS=true` and
  `ODUDU_TRUST_PROXY=true` booted (`migrations applied`, listening), `/health/ready` answered `{"status":"ok","checks":{"database":"ok"}}`,
  `odudu seed admin --username ada` printed a one-time password, and discovery with `x-forwarded-proto: https` named an `https://` issuer. So the
  owner needs `CREATEROLE` and `BYPASSRLS`, not a superuser. `odudu init` is not a production route: `assertLoopbackBase` refuses a base that is
  not loopback.
- **Guard order.** Without `ODUDU_TLS`, the server stops with `ODUDU_TLS must be true when NODE_ENV=production` before it connects; the
  hardening page runs that refusal in the docs-run job (`docker compose run --rm --no-deps -e NODE_ENV=production -e ODUDU_TLS=false odudu`).
- **Tests.** `apps/docs/tests/operating.test.ts`: every variable each exported `assert*` in `config-guard.ts` reads appears on the production
  settings page and on the hardening page, with at least one checklist item per guard; the deploying page's proxy warnings and the root-of-origin
  sentence; the threat model cites only ADRs that exist; every workspace directory of `apps`, `packages` and `tools` is named on the architecture
  page. The docs-run job now also runs the operating pages (64 blocks, `MINIMUM_BLOCKS` raised from 59), proven on a fresh quick-start stack.
- **Titles.** A page titled Configuration collides with the generated reference's title in `llms-full.txt`, so the operating page is "Production
  settings" (file `configuration.md`).

## Increment 28: the examples

- **Shape.** `examples/` is outside the pnpm workspace; each of `web-app`, `api` and `machine-to-machine` is a standalone npm project with
  its own lockfile, Apache-2.0 `LICENSE` and README, run by Node 24's type stripping. `_shared/provision.sh` is the one script that makes
  the tenant, `ada` and the two clients (`example-web`, `example-m2m`; published demo secrets) and is safe to run twice;
  `_shared/browser.ts` drives the web app's sign-in with the docs app's Playwright (`createRequire` from `apps/docs/package.json`).
- **Job.** `examples` in `verify.yml` (needs `changes`, `buildImage`, in `gate`'s needs): matrix of the three, the image built from the
  commit, stack on port 3205, provision, `npm ci --ignore-scripts`, `npm test`; the log names the image id. Each `test.ts` starts the
  subject itself, so the job has nothing to start. The single-page app and the tag trigger belong to the next increment.
- **verified:** `npm view openid-client@6.8.8 time` gives 2026-09-05, `npm view jose@6.2.12 time` 2026-09-05, both past the 1440-minute
  age; `npm ci --ignore-scripts` from the committed lockfiles installs each.
- **verified:** a fresh `quickstart/stack.sh up` then `examples/_shared/provision.sh` (twice) then `npm test` in each example: web-app 3,
  api 6, machine-to-machine 2 tests pass. A second `provision.sh` run changes nothing (`seed` reports "already exists" for the user and
  the clients).
- **Scope.** `seed client` had no flag for the `client_credentials` scope allowlist (`clientCredentialsScopes: []` was hard-coded), so a
  seeded service could only get an empty scope. The examples expose that, so it is this phase's: `--client-credentials-scope` (repeatable)
  is parsed beside the sibling list flags, bounded by `CLIENT_LIST_LIMIT`, refused on a client that cannot use the grant and for a
  value that is not one scope token, and appears in the generated CLI reference. The API example now returns `403` for a token without
  `reports:read`, and the machine-to-machine example asks for it.
- **Finding: audience.** Odudu names the tenant issuer as `aud` unless a client says otherwise; the API example trusts that by default
  (`API_AUDIENCE` changes it), and its test shows a second instance expecting another audience refuses the same token.

### Increment 28, fix round 1

- **Web app proof.** `test.ts` drives Chromium and alters one request at a time, then reads the reason the app logs for a refusal: a forged
  `state` with a valid code (state), an authorize request carrying another nonce (nonce), a code bound to another PKCE challenge
  (`invalid_grant`), the same callback replayed (no sign-in under way), plus the authorize URL's parameters and the sign-out. Mutations,
  each failing the named test: `expectedState` skipped, `state` not sent, `S256` changed to `plain`, redirect address given a trailing slash,
  wrong verifier sent (sign-in fails), pending session not deleted (replay), logout that skips Odudu. Dropping `expectedNonce` is caught by the
  success test: the library refuses an ID token with a nonce nobody expected, so that check fails closed.
- **API proof.** `verifier.test.ts` (no stack) covers issuer, audience, `typ`, expiry, bad signature, unknown key, key rotation, `alg: none`,
  HMAC keyed by the public key, an ES256 token from a published key, and the scope check. Removing `issuer`, `audience`, `typ`, or
  `algorithms` from `makeVerifier`, using fixed keys instead of the remote set, or a scope check that always says yes each fails a test.
  `alg: none` and the HMAC token are refused by `jose` even without `algorithms`; the ES256 case is what that option decides.
- **verified:** sign-in is limited to five tries a minute for one person and ten for one address (`DEFAULT_LOGIN_THROTTLE`,
  `DEFAULT_THROTTLE` in `apps/server/src/app.ts`); a 429 from it made the browser tests time out. The provisioning script makes `ada` and
  `ben` so each stays under it.
- **Typecheck.** Each example has a `tsconfig.json`, `typescript` 6.0.3 and `@types/node` 24.19.1 as dev dependencies and an
  `npm run typecheck` that the examples job runs. `web-app` overrides `jose` to 6.2.12, so both lockfiles resolve the same version.

### Increment 28, fix round 2

- Closed: `seed client --client-credentials-scope` refuses a quote, backslash or non-ASCII scope and a scope on a public client (naming the
  flag), and stores a repeated scope once in the order first named; the console capture's platform pin is one exported function
  (`pinPlatform`, with `getHighEntropyValues`) and one context factory (`newPinnedContext`) that a test calls with a fake browser and runs
  in a `vm`, and `run.ts` says what the pin hides; the examples link test's reads (`examples/README.md`, `_shared/**`, link targets) are in
  `READS` and `docs#test`'s inputs, and a test fails when a README link leaves them; the machine-to-machine token source shares one
  in-flight request.
- Accepted: the nonce test cannot tell a removed `expectedNonce` from a present one, because the library fails closed with wording that
  names the nonce; the sign-in test catches the removal. Noted in the test.

## Increment 29: the single-page app, and the examples job for all four

- **verified:** a fresh `quickstart/stack.sh up` then `examples/_shared/provision.sh` then `npm test` in `examples/single-page-app`: 9 tests,
  RED first (empty `src/main.ts`: every browser test timed out), then GREEN. The test builds with `vite build` and serves with
  `vite preview`, so what runs is what ships.
- **verified:** `oauth4webapi` 3.8.8 with `None()` client authentication is the public-client path; `validateAuthResponse` checks `state` and
  the `iss` parameter, `processAuthorizationCodeResponse` checks the ID token (signature, issuer, audience, nonce). Discovery and `/certs`
  answer every origin; the token endpoint answers only a registered `web_origin`, so the sign-in itself proves the registration.
- **verified:** a public client with the default grants gets a `refresh_token` for `openid profile`; registered with `--grant-type
authorization_code` it gets none (`Object.keys(tokens)` logged from the built app against each registration). The example is
  registered without the grant and keeps tokens in a variable. After a reload, choosing Sign in again returns signed in without the password form (the
  tenant session still lives), which the test asserts.
- **verified:** before fix round 1, `/logout` resolved the registered post-logout addresses from the `client_id` parameter only, so a hint
  alone signed the person out but did not return them to the app. It now takes the client from a hint's single audience (fix round 1
  below); the examples still send `client_id` beside the hint.
- Mutations, each failing the named test: `skipStateCheck` (state), `state` not sent, `S256` to `plain`, a trailing slash on the redirect
  address (authorize parameters, sign-in), wrong verifier (sign-in), `expectedNonce` dropped (sign-in; the nonce test cannot tell, as in the
  web app), pending values not deleted (replay, storage), tokens written to `localStorage` (storage), a logout that skips Odudu, a logout
  without `client_id` (sign-out).
- Sign-in is throttled per person (five a minute), so a second run of the browser tests inside a minute times out; CI runs each example
  once on a fresh stack.
- The `examples` job stays in `verify.yml` with one matrix leg per example directory, now four. No tag-triggered run exists yet because
  `release.yml` has not been written on this branch; the run against the published image and the `v0.1.0-rc.2` cut are Task 6c of the plan, and
  the criterion stays open until it has run.

### Increment 29, fix round 1

- **Server:** `handleLogoutRequest` resolves the client from a verified hint's single `aud` when `client_id` is absent, so an RP that sends only
  `id_token_hint` and `post_logout_redirect_uri` is returned to a registered address. Several audiences, an audience that is no client of the
  tenant, an unregistered address and another client's address are all refused with the session still ended; a `client_id` that disagrees with
  the hint is dropped as before. The confirmation form carries the resolved client. `[ODUDU-LOGOUT-HINT-CLIENT-01]` in `logout.int.test.ts`
  (GET and POST, expired hint, hint from another tenant, client only another tenant has); reading note in `docs/protocols/oidc-rpinitiated.md`.
  The OIDF plans in `infra/conformance` hold no RP-initiated logout test, so no plan variant covers this path. The examples still send
  `client_id` beside the hint and say so.
- **Plan:** the published-image run and the `v0.1.0-rc.2` cut are Task 6c.
- **verified:** a public client registered with `--grant-type authorization_code` gets no `refresh_token`; the example is registered that way.
- Example: `expiryOf` returns nothing for an opaque token or a missing `exp` (`expiry.test.ts`); the storage test also checks cookies and
  IndexedDB; a forged `iss` on the callback is refused (library message pinned); README says what happens after the access token lapses.

## Increment 30: the mark

**Owner gate 1 closed on 2026-10-21: the mark is candidate B, the crossbar at y=14 (the collar).** A (y=20, the plan's drawing) and C (y=25) read as the
sign for Venus; B reads as a sceptre. The monospace wordmark (IBM Plex Mono Medium outlines, SIL OFL, licence kept in `brand/`) stands. The amber ring
in the favicon, touch icons and social image is the builder's choice and the plan does not ask otherwise, so it stays; `mark.svg`, `wordmark.svg` and
`lockup.svg` are single-colour. No Nsibidi-inspired detail is drawn; nobody who knows the tradition confirmed one.

The assets live in `brand/`; `node brand/build.ts` regenerates every PNG and the ICO from the SVGs. Previews are in `docs/phases/p4g-docs/`:

| Preview                                                                | Shows                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| ![The mark at 16, 24, 32 and 180 px](p4g-docs/brand-mark-16-light.png) | `brand-mark-{16,24,32,180}-{light,dark}.png`         |
| ![Lockup, light](p4g-docs/brand-lockup-light.png)                      | `brand-lockup-{light,dark}.png`                      |
| ![Candidates](p4g-docs/brand-candidates.png)                           | The three crossbar heights that were compared        |
| ![Social image](p4g-docs/brand-social.png)                             | The 1200 x 630 share image (also `brand/social.png`) |
| `brand-favicon-{16,32}.png`, `brand-mail-mark.png`                     | The tile at favicon sizes and the mail mark's 80 px  |

### Wiring

- `packages/instrument/src/mark.svg` (the favicon every page links, and the mark the pages embed inline) is the new geometry; the four `document.ts`
  renderers (`protocol-oidc`, `account`, `authn-flows`, `console-gateway`) carry the same shapes inline, and `tests/lint/brand-assets.test.ts` holds
  all five to `brand/mark.svg`'s geometry. The console app shows no mark of its own, so its captured screenshots and records did not change.
- `rasteriseMark` in `packages/email` read one circle and one stem. It reads a circle and any number of straight strokes now, with round caps, and
  `mark-png.test.ts` asserts the collar, the ring's open hole and the shaft on the rasterised pixels. The mail assets were regenerated (the PNG is 893
  bytes); the page and mail transcripts carry the new inline mark, their `content-length` and the inline `Size` re-derived.
- The documentation site's favicon and share image are the brand files. They are copied into `apps/docs/static/brand/` and committed, not copied at
  build, because the container's docs stage copies only `apps` and `packages`; `brand-assets.test.ts` fails on any difference between the two.
- **verified:** `node brand/build.ts` exports the PNGs with the Chromium `apps/docs` already installs (`@playwright/test` 1.63.0, resolved from
  `apps/docs/package.json`); `social.png` is 1200 x 630 and under 300 KB, `favicon.svg` is under 1 KB.
- **verified:** the wordmark outlines come from `opentype.js` 1.3.4 reading `ibm-plex-mono-latin-500-normal.woff` of `@fontsource/ibm-plex-mono` 5.3.0
  (`Font.getPath`), one path per letter; the dependency is not added to the repository.
- The plan's shaft started at y=9, inside the ring's stroke, so its round cap poked into the hole; it starts at y=10. At 16 px the one-pixel stroke
  straddles two pixel columns, and the test asserts continuity and an open hole rather than pixel-exact edges.

### Increment 30, fix round 1 (review of the mark)

- **Copies tied to the source.** `brand-assets.test.ts` reads the ring, shaft and collar out of `lockup.svg`, `favicon.svg`, `social.svg` and the two
  fixed-ink marks and fails unless each equals `mark.svg`'s. verified by mutation: the bar moved to y=20 in each of `lockup.svg`, `favicon.svg` and
  `social.svg` failed the named test (the last two also fail the regeneration check).
- **Derivatives reproduced.** `node brand/build.ts --check` rebuilds the PNGs and the ICO from the SVGs and compares them with the committed files.
  verified: two consecutive builds on this machine gave identical SHA-1 for every PNG and the ICO, so Chromium's output is byte-stable here; the check
  still compares by pixel (at most 0.5% of pixels differ by more than 12 in a channel, none by more than 64), because another machine's rasteriser is not
  promised to match. The brand test runs it.
- **The amber ring.** The shaft and collar are drawn first and the ring last, so the shaft's cap no longer notches it. The test samples the ring every
  10 degrees in the touch icon, the 512 icon and the social image (all within 30 of the amber, and the hole is the rail colour).
- **Tiles.** The favicon is inset to 87.5% of its tile and the touch and install icons to 75% (`brand/geometry.ts`); the README's clear space is for the
  mark on its own. The lockup gap is 34 units, not 42.
- **Rasteriser.** `rasteriseMark` honours `stroke-linecap` (butt, round, square), refuses another value and a zero-length stroke, and its tests sample
  anti-aliased edge pixels.
- **Not done, with the reason.** The wordmark outline script is not committed: it needs `opentype.js`, which the repository does not depend on, and the
  outputs are committed and tested. `brand/build.ts` and `geometry.ts` are now type-checked by `brand/tsconfig.json` in `pnpm typecheck`, and the
  `allowDefaultProject` entry for them is gone.

### Increment 30c: the mark where people see the product

- **Console.** `BrandLine` (shared view: the staff beside a name) is the rail header and the top bar's brand, on the pending frame, on the screens the
  console draws without a tenant (`LostFrame`: not-found screens) and on the sign-in, signing-in and signed-in-elsewhere screens (`SessionStatus`). The
  mark is decorative (`aria-hidden`, no title) because the product name is always beside it. The console draws it from the same three shapes in JSX,
  not a second SVG file: importing `packages/instrument` would pull its server code into the bundle, and a test ties the JSX to `mark.svg`.
  Tenant branding stays with P4b.
- **Icons.** `apps/admin-console/index.html` links the same icon the server pages use (`/instrument/mark.svg`) and the touch icon, which the
  instrument package now serves as `/instrument/apple-touch-icon.png` (a copy of the brand file; the build copies it, `routes.test.ts` serves it).
  The console gateway serves that index.html, so it has no shell of its own. The server pages do not link a touch icon: a sign-in page is not
  something a person pins, and adding the tag would change every recorded page.
- **Documentation site.** The navbar and footer carry the mark (`brand/mark-ink.svg` and `mark-paper.svg`, switched by colour mode), alt empty beside
  the title; the head carries `favicon.ico` and the touch icon under the site's base path (`iconTags`). The 404 page shows the navbar.
- **Every server page kind.** All 15 `*-html.ts` renderers return their markup through `page()` of the package's `document.ts`, which carries the mark
  (a test checks the file list and the call), so the 37 kinds in `p4g-pages/` all have it; none was found without.
- **Captures.** The 50 console images were recaptured (`with-stack.sh`, platform pin); the 50 records and the manifest did not change, because the mark
  adds no text. `--check` passed twice on macOS and once from the Linux Playwright container (`mcr.microsoft.com/playwright:v1.63.0-noble`, localhost
  forwarded to the stack on the host). The pictures that show the header are these images; there are no others in the tour or quick start.
- **Not run.** The console e2e (`apps/admin-console/e2e`) signs in through a full stack and the capture already does that against the built image;
  nothing it asserts about the shell changed.
- Screenshots (`docs/phases/p4g-docs/`, light and dark): `brand-wired-docs-{home,404,footer}-*` (docs), `brand-wired-server-page-*`,
  `console-pending-*` (the real rail header and top bar on the pending frame, desktop and 375 px), `console-lost-*` (`LostFrame`),
  `console-status-*` (`SessionStatus`), and `brand-wired-console-rail-captured-*` (the rail header cropped from the captured console images).
  The earlier gallery pictures, whose rail has a plain header of its own, were removed.

### Increment 30c, review follow-up

- README wording for the touch icons; `Mark` is no longer exported; the product name has two constants in `shared/service/product.ts` (`PRODUCT_NAME`,
  the lowercase wordmark, and `CONSOLE_TITLE`, `Odudu console`), AppShell's default brand and the session screens use them, and a test fails on a
  stray literal in that markup. The renderer test reads each exported function (and what it calls in its own file) for `page()`, proven on a rogue
  export added to `reset-html.ts`; the console-copy test compares parsed JSX attributes, proven by moving the bar in `BrandLine.tsx`.
- Docs head: the icon file, then the SVG icon (`type`, `sizes="any"`), then the touch icon, read from the built head by `seo-html.test.ts`; the
  Docusaurus `favicon` option is gone so nothing precedes them. verified: `<link rel=icon href=/odudu/brand/favicon.ico sizes=48x48>`,
  `<link rel=icon href=/odudu/brand/favicon.svg type=image/svg+xml sizes=any>`, `<link rel=apple-touch-icon ...>` in `dist/pages/index.html`.
- The touch icon route test asserts `no-cache`, an etag and a 304; the console dev server proxies `/instrument` to the server.
- `tests/lint/capture-keeps-secrets.test.ts` fails on `set -x`, `bash -x` or a line that writes the password in `with-stack.sh`, the capture scripts, or
  any workflow (traces only for workflows, which may write a masked secret to their environment file); proven by running with `set -euxo`.

### Increment 31, Lighthouse method and what the cost is

- **verified:** `npx --yes lighthouse@12.6.1 <url> --throttling-method=simulate|devtools [--preset=desktop]
--only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox"`, with
  `CHROME_PATH` set to the Chromium Playwright installs, against a copy of `apps/docs/dist/pages` served by
  `node apps/docs/scripts/serve.mjs dist/pages --base /odudu/ --port <free>` (gzip, as a host serves it). Nothing is added to
  the repository; 31b's `@lhci/cli` runs the same engine.
- **Numbers on the shipped home page** (two runs each): simulated mobile (Lighthouse's default, Lantern) performance 0.92 to
  0.93, LCP 3.3 s, FCP 1.1 s, CLS 0, TBT 50 to 70 ms; devtools-throttled mobile (4x CPU, 1.6 Mbps, 150 ms RTT, applied for
  real) performance 0.97, LCP 1.9 s, FCP 1.9 s, TBT 90 to 110 ms. Desktop preset: 1.00 and LCP 0.7 s simulated, 0.1 s
  devtools. Accessibility, best practices and SEO are 1.00 in every run.
- **Finding:** the simulated LCP is not the hero. The LCP element is the lede paragraph, which natively paints at 50 to 100 ms.
  Lantern's pessimistic graph counts every script, font and image that finishes before it as blocking. Removing all script
  tags (diagnostic only) takes simulated LCP from 3.2 s to 1.9 to 2.0 s: the cost is the shared Docusaurus bundle (`main.js`,
  174 KB gzip, plus a 7 KB runtime), not the landing chunk (12 KB gzip) and not the hero. Removing the hero image preload
  changes nothing; removing the three font preloads makes FCP worse (1.05 s to 1.65 s); inlining the whole 24 KB stylesheet
  saves about 0.3 s.
- **Cheap wins taken:** the 13 KB of generated travelling-signal keyframes are written once into the stylesheet
  (`travel.css`, held to `geometry.ts` by a test) and no longer ride in the markup and the script; the reveal and the
  typewriter load after idle; the three Plex files the first screen uses are preloaded. **Not taken:** inlining critical CSS
  (Docusaurus has no switch for it without a plugin, which this phase does not add) and anything inside the 174 KB bundle.
- **For 31b:** the 2.5 s LCP budget is met under real throttling (1.9 s) and not under the simulated profile (3.3 s) while
  the bundle is what it is. The spec must say which method asserts the number before the job enforces it; the home page
  would pass only the devtools method today.

### Increment 31, font licences

IBM Plex Sans and Mono (SIL OFL 1.1) are served by the console, the server's pages and the documentation. Their licence texts
and copyright lines are `LICENSES/OFL-1.1-IBM-Plex-{Sans,Mono}.txt` (copied from the `@fontsource` 5.3.0 packages),
`THIRD-PARTY-NOTICES.md` lists them, `LICENSING.md` points there, and the documentation builds publish the texts under
`/licenses/` (`apps/docs/static/licenses/`, held byte for byte to `LICENSES/`). `tests/font-licences.test.ts` fails when a
family served from a font file in either build has no notice, no published text or no copyright line. The console's own
build and the server's pages ship the same fonts; their copy of the notice is not yet published beside them. That belongs to Increment 33 (community and notice files): serve
the same two files from the console's and the server pages' static output and extend the test to those builds.

### Increment 31f, the docs app follows the console's layering

`apps/docs/src` is `features/{landing,docs-home}/{view,usecase,service}` and `shared/{view,usecase,service}`, with the
Docusaurus-pinned `pages/`, `image-pages/`, `css/` as they were; a view calls its feature's usecase, a usecase hands the
browser it needs (a clock, an observer, a random source) to a pure service, and a component is a folder of its markup, its
CSS module and its test. Held by the `docs-*` dependency-cruiser rules (resolved through `.dependency-cruiser-resolve.cjs`,
since `@site/…` is not in the base tsconfig), the react-hooks and `complexity: 8` eslint rules,
`tests/lint/docs-no-readonly.test.ts` (no `readonly` in any docs type; the console keeps its readonly props and a codemod is the owner's call), and the console's lints for duplicate exports, module state, manual memoisation,
custom properties, CSS module classes, file extensions and usecase logic, which now read the docs app too (each shown to
fail on a planted violation). The lints found three things the old layout hid: a CSS class (`prompt`) used and never defined,
a custom property (`--below-height`) read and never set, and `--ifm-navbar-height` used without being declared.
**Pixel comparison**, reproducible with `apps/docs/scripts/compare-landing.mjs <dist/pages A> <dist/pages B>`: each
build is served and captured in Chromium under reduced motion (1280 and 375 px, both colour schemes; fold, full page and
the four scene steps, 24 captures) and the PNGs are compared on a canvas in that Chromium. Run on one machine against a
`git worktree` of each commit, built with `pnpm build:pages`. 325fd8d0 against 780eab7a (the CI fix): 22 identical, the
two mobile full-page captures differ by about 585 pixels (the font and hero changes, not the layering). 780eab7a against
the review round's HEAD: all 24 identical in three runs and one run in which a capture differed, so a capture is not
deterministic to the pixel. The hero's float and typing are not compared, because they move.
The first run of the review round found that the scene model drew the return route's line, which the old view never did;
that changed about 200 pixels and is now a `lines` and a `heads` list with a test that the return line is never drawn.

### Increment 31d, the documentation under `docs/`

Both builds put every page at `docs/<page>/` under the root of the site that serves them. The Pages build keeps the
landing at its base and sets the docs plugin's `routeBasePath` to `docs`, so a page is `<origin><base>docs/<page>/`; the
image keeps base `/docs/` and `routeBasePath: '/'`, so the server's `/docs/<page>/` is the same shape. `site.config.ts` holds
`DOCS_DIRECTORY`, `IMAGE_BASE`, `PAGES_DOCS_BASE` and `docsRoute()`, and everything else derives from them: the navbar and
footer links, the search plugin's `docsRouteBasePath`, the agent copies (written under `docs/`, their links rewritten
with the docs route, `llms.txt` and the OpenAPI reference staying at the site root) and `customFields.docsRoute`, which a
`DocsLink` view reads through `useDocsAddress` so the landing's and the home map's links follow the build.
The old unprefixed routes are not kept. A `docs/` page (`src/pages/docs/index.tsx`, the home map with the public intro) fills
the address the docs plugin serves nothing at, and the landing links it, since nothing else would.
**Left where the theme fixes them:** `search/` and `search-index.json` stay beside the landing, because the search plugin
registers its results page at `<base>search`; `tests/layout.test.ts` names them in its allowlist.
**Two traps hit while building:** a root-relative Markdown link (`/quick-start/`) is base-prefixed only, so with the docs under
`docs/` it is a broken link (the generated-page test now links `/`); and a build after a build of the other target without
`docusaurus clear` bakes the first one's base into the font URLs (the package scripts clear, a hand-run sequence must).
verified: `pnpm test` (exit 0), docs browser project 83, `tests/docs tests/lint tests/boundaries` 713, `pnpm typecheck`,
`pnpm lint`, `pnpm boundaries`; Lighthouse 12.6.1 simulated mobile on the landing, two runs: performance 0.92, LCP 3.4 s,
FCP 1.1 s, TBT 30 to 40 ms, CLS 0, other categories 1.00 (before: 0.92 to 0.93, 3.3 s). axe on `/`, `docs/` and `docs/guides/`
at 390 px, both schemes: no violation; the search page is covered below.

**Review follow-ups.** The search plugin's page put its content in the layout with no `<main>`, so it failed `landmark-one-main` and
`region`. `src/theme/SearchPage` wraps the plugin's page in a `LandmarkProvider` and `src/theme/Layout` wraps the theme's layout, putting
its children in `<main>` only when a page asked (a context, so the plugin's page is not copied); `tests/search.browser.test.ts` runs axe on
`search/` in both builds, both schemes, at 1280 and 390 px, and `layout.test.ts` holds every built page to one `<main>`.
The 404 page carried canonical and `og:url` `<base>404.html/` before this increment too (verified: `b48016ea` built in a temporary
worktree); the `not-found` plugin strips them on the Pages build and adds `noindex`. `docusaurus clear` removes `node_modules/.cache`
whole, fixture trees included, so the test harness removes only `.docusaurus` and the bundler's `rspack` cache between builds.
**A root-relative Markdown link on the Pages build:** verified by planting a root-relative link to the quick start in a copy of the content: the build fails
under `onBrokenLinks: 'throw'` ("Broken link on source page path = /odudu/docs/introduction/ -> linking to /odudu/quick-start/"), and
`tests/docs/root-relative-links.test.ts` now fails at the source, naming file and line.

### Increment 31e, standard 404 and 500 pages

**Server.** An address no route claims, and a failure no handler claims, are answered by the root of `apps/server/src/app.ts`
through `answerNotFound` and `answerServerError` (`packages/protocol-oidc/src/view/routes/unrouted.ts`). A browser navigation (GET or
HEAD, `Accept` naming `text/html` outright and ranking it at least as high as any JSON type) gets `not-found-html.ts` or
`server-error-html.ts`: platform look, the shell's mark, one line, and links to the console and `/docs/` only where this deployment has
them. Everything else, and every path under `/admin`, `/console/api`, `/health*`, `/instrument`, `/.well-known` and
every segment under `/tenants/:t` except `login-actions` (the browser flows; a test enumerates the registered tenant routes and asserts the class of each, so a new prefix is an API until named), keeps `application/problem+json` with the detail "No resource at this path". The page carries `Vary: Accept, Accept-Language, Cookie` and `no-store`; the problem document on a
negotiable path carries `Vary: Accept` and `no-store`. The not-found page names nothing of the request, and an
unknown tenant and an unknown path are the same bytes (`apps/server/tests/unrouted.int.test.ts`). The 500 page prints the request id
only when it is a plain token (the id is client-supplied through `x-request-id`) and never the error.
**Moved:** the admin plugin's own `setNotFoundHandler` (it was global in effect, and worded "No admin route for <path>", which echoed the
path) is gone, and `about:blank#not-found` left the admin problem vocabulary because that package no longer emits it; the console gateway
still emits it under `/console/api`, and the errors page now says so in prose.
**Details.** `q` follows RFC 9110 (0 to 1, three decimals); an entry with any other q is read as not sent. Every failure of status
500 or above answers 500, as before. A renderer that throws falls back to the fixed problem document. The `not-found` type is listed in
the errors table again (its detail now reads "No resource at this path", where it named the route and the path). Pointer replay also
replays once as the pointer leaves, because the animation name swaps back: it is user-initiated and bounded to 4.8 s, and CSS cannot
run it on enter only; kept and documented.
**Console gateway, decided:** unknown `/console/*` stays the shell with status 200. The route table is the client router's, under a
tenant segment the server cannot enumerate, so a server-side list would be a second copy that drifts; the client's not-found screen is
the answer, and `console-shell.int.test.ts` pins the behaviour.
**Docs 404:** `src/theme/NotFound/Content` renders `features/not-found` (mark, one line, links to the documentation home, the quick start
and search); the theme's route keeps its metadata, so the page stays noindex. `tests/not-found.test.ts` reads both built 404 pages.
**The drawing.** One source, `packages/instrument/src/lost.svg` (a browser window, a route that breaks at a gap, a `?` badge, the leaning
staff; under 1 KB, decorative, `aria-hidden`, no text). It is inlined on the server's 404 through `view/lost-art.ts`, drawn by the docs
`LostArt` and the console's `shared/view/LostArt` (used by `PageNotFound`, so it shows inside the signed-in shell and in `LostFrame`),
and `tests/lint/lost-art.test.ts` holds every copy to the source's elements and geometry, as the staff mark is held to `mark.svg`. The
server 500 page shows the same drawing still (`lost-calm`: upright staff, route bridged, no badge). **Motion decision:** the sequence
(route draws, badge settles, staff leans) runs twice back to back, 2.4 s each, 4.8 s in all, then rests on its last frame, so it stops by
itself inside the five seconds WCAG 2.2.2 allows and needs no pause control; a pointer over it replays it (user-initiated, so exempt),
by swapping to an identical set of keyframes under another name, in CSS alone and with no script (the server pages' policy has none).
There is no keyboard replay: the drawing is decorative and takes no focus, and a tab stop for it would only confuse the page. Under
`prefers-reduced-motion: reduce` it shows the final frame and never replays. Only transform, opacity and stroke-dashoffset move. A true
loop would need a pause control and is the owner's call to ask for later. The pages' stylesheet budget moved from 360 to 600 lines
and the `main > svg` rule that whitens the QR code now leaves the drawing out. Frames (start, middle, end; light and dark; desktop and
phone) are `server-404-*-frames.webp`, `docs-404-*-frames.webp` and `console-lost-*` in `p4g-docs/`.
**Preview server:** `apps/docs/scripts/serve.mjs` now behaves as Pages does: a directory without its slash is a 308 to the slash form
(query kept), every miss under the base is the build's `404.html` with status 404 (plain text only if the build has none), a path
outside the base is plain 404, HEAD answers headers only; `tests/serve.test.ts` spawns it on an ephemeral port against a temporary build.
**Gallery:** `not-found` and `server-error` are captured by `server-pages.spec.ts` (the 500 on a second server whose application
database is unreachable, so it is a real failure), with axe in both themes, phone fit and card width, so the gallery has 39 kinds.
**Transcripts:** none re-derived. The unknown-path responses the guides show (`ODUDU_DOCS=false`, the `OPTIONS` preflight) are requests
without a browser `Accept`, and their shown headers and bodies are unchanged; the only response whose detail changed is the one nobody
had recorded.

**Performance of the unauthenticated path** (`tools/bench/unrouted.mjs`, a real-socket burst with keep-alive over a database that throws on
any use, so Postgres connections stay at zero by construction; 20,000 requests, 32 connections, this machine, Node 24):
404 problem document 26,505 req/s, p50 1.14 ms, p99 1.80 ms; 404 page 22,690 req/s, p50 1.37 ms, p99 1.80 ms (a tenant path is the same:
22,016); 500 problem document 23,615 req/s; 500 page 16,911 req/s, p50 1.82 ms, p99 2.51 ms. The page costs 1.2 to 1.4 times the
document, inside the 2x line, so nothing was precomputed. Bounds: no query on either answer (`apps/server/src/unrouted.test.ts` uses a
database that throws); `Accept` over 2 KB is no preference and is refused before it is read, `Accept-Language` is capped by the
negotiator (bytes and entries), a path is lower-cased and decoded once, so every step is linear in a request line Node already caps at
16 KB; nothing keys on a path or keeps per-request state, which `tests/lint/unrouted-no-state.test.ts` reads as syntax (no `let`, no empty
Map or Set, no write through a module-scope name) in place of the heap-growth test it replaces. The database test counts every property
read and call on a recording handle and asserts zero for the 404 page, the 404 and 500 documents and the 500 page; a test that reads
it shows the detector fires.

### Increment 31h, the console's failure screens

**Found.** The console had `ChunkBoundary` (chunk-load errors only; it rethrows the rest "to the boundary above") and a not-found
component, and nothing else: no router `errorComponent`, no root boundary, no `createRoot` callbacks. A render error inside a route
showed TanStack's unbranded default with the raw message; one above the routes left a blank page. Reading the installed router
(1.170.39, `Match.js`, `Matches.js`, `CatchBoundary.js`) also showed a third surface: `MatchesInner` wraps the root match in its own
`CatchBoundary` with the unbranded `ErrorComponent`, switched off by `disableGlobalCatchBoundary`. A route that sets no
`errorComponent` and a router with no `defaultErrorComponent` gets **no** boundary at all (`ResolvedCatchBoundary` is a fragment).

**What a person sees.**

- A page that throws while rendering: the rail and top bar stay; in place of the page, a panel under the heading "Something went
  wrong" with "Try again" (resets the boundary and draws the page again), "Back to overview" (a link, so the unsaved-changes guard
  asks first) and "Reload the console" (also through the guard). Focus is on the heading. Below it, "Quote this when you report the
  problem": a block of three lines, the error id (8 characters from `crypto.getRandomValues`, no I, L, O or U), the route as a
  template (`/$tenant/clients/$id`, never the address, tenant or query) and the time, with a Copy button that copies exactly those
  lines. A new failure on Try again draws a new id. Navigating away resets the boundary (the router's reset key is the match).
- The shell itself failing (the root and tenant routes draw it): the same panel alone on the page under the product name, with the
  same three actions.
- A failure above every route (providers, toast region, router machinery): a standalone page, the product name, the same panel and
  a single "Reload the console". It reads no context the failed tree provided; it needs only the design tokens. Its route line is read
  from the router's state when it draws, so it says `(none)` if the router never matched anything.
- Production never shows the error message or stack on the page. A development build (`import.meta.env.DEV`) also shows the message.
  The full error goes to `console.error` beside a line that carries the same id: `odudu console failure 9CMGSK6X (rendering) at /$tenant/keys`.
- A chunk that did not arrive keeps its own page ("This part of the console could not be loaded"); any other error it caught is
  thrown on to the panel above, as before.

**Decisions.**

- `features/failure` (service: report, id, details text, wording; adapter: CSPRNG, build mode, console, reload; repository: the
  adapter behind a few functions; usecase: `useFailureReport`, `useRouteFailure`, `useRootFailure`, `recordFailure`; view:
  `RouteFailure`, `ShellFailure`, `RootFailure`, and the one class, `RootBoundary`, which holds the error and draws). The panel
  itself is `shared/view/FailurePanel`, wording passed in as props, because the gallery may show only shared views. `CONSOLE_ROOT`
  moved to `shared/service/address` (the session feature re-exports it), because a service may import only services. Searched
  before writing: `shared/view` (`ChunkBoundary`, `LostFrame`, `EmptyState`, `CopyValue`, `Button`, `ButtonLink`, `BrandLine`),
  `shared/service` (`failure.ts` is about gateway results, not render errors), `features/session` (`useReloadConsole`, which is the
  guarded reload; `CONSOLE_ROOT`, now exported from its index), `shared/adapter/clock`. Reused: `LostFrame` for both standalone
  variants, `CopyValue` (block form, so the copied text is the shown text), `Button`, `ButtonLink`, `useReloadConsole`,
  `currentTime`, `tenantPage`, `isTenantName`. A new feature rather than `shell` or `session`, because it is neither of theirs and
  both would otherwise import it back.
- Heading focus, and `role="alert"` on the one-sentence summary only (see the fix round below). A panel drawn as a gallery specimen takes neither
  (`announced={false}`), and is a `div`, since two copies on one page would be two landmarks of one name.
- A route reports its own id (state made once on mount, logged in an effect). `onCaughtError` is therefore told to log only what no
  panel shows an id for: the chunk boundary's `ChunkLoadError`, and any boundary that is not ours or the router's; an error a panel
  caught is not logged a second time under another id. `onUncaughtError` and `onRecoverableError` always log, with an id and the
  component stack. `rootErrorOptions` is in `app/` because it names the three boundary classes.
- The page that threw is not named by message anywhere a person can copy it; the three copied lines carry nothing about them.
- `disableGlobalCatchBoundary: true`, so an error above the root match reaches `RootBoundary` rather than the router's unbranded panel.

**Gaps, placed.**

- **No client-error endpoint.** Nothing receives these reports: the id exists to be quoted by a person and found in a browser
  console. An endpoint that stores them is a separate decision (what is stored, retention, who can read it, abuse of an
  unauthenticated sink) and is not built here. Owner decision, not scheduled.
- **No revision in the details.** The console bundle does not know the image's revision (`ODUDU_REVISION` reaches the image label,
  not the build), so the details carry none. Carrying it would put the revision in the bundle's hash and change every chunk on
  every commit; left unbuilt.
- **`window` `error` and `unhandledrejection` listeners are not added.** Nothing proved a need. Today an error in an event handler,
  a timer or a promise that is not awaited by React is not a render error, so no boundary sees it: the browser reports it in the
  console as an uncaught error with no id, and the page stays as it was (not blank, and not swallowed). The console's own calls
  return failures as values (`GatewayResult`), so this is not a path its pages use to fail. If one were added it would log with the
  same `recordFailure`; it would draw nothing, because there is no page to replace.
- **The root fallback's Reload skips the unsaved-changes guard**, because `RootBoundary` has already unmounted the whole tree: every
  form, and the guard's dialog with them. Nothing more is lost by reloading; the browser's own `beforeunload` prompt is not available
  either, since the listener lived in the failed tree. If drawing the root fallback fails too, `FallbackBoundary` logs the first
  error under an id and draws `MinimalFailure` (a heading, a sentence, the id, a link to the same address); only an error in that
  static page would leave a blank one, and `onUncaughtError` logs it with an id.
- **Not caught by a boundary, by React's design:** an error in an event handler, a timer or an unawaited promise. The browser reports
  it in the console, the page stays as it was and nothing is drawn (`RootBoundary.test.tsx` pins the handler case; the tour says so).
  A route `loader` or `beforeLoad` error would reach the same panel (`Match.tsx` rethrows `match.error` inside the match boundary);
  this app has none, so it is latent and untested. If a route panel itself throws, the next boundary up draws its panel for the
  second error; the first is logged by the panel's own effect only once that panel commits.

**Tests.** Services (`report`, `address`) were written first and watched fail on the missing module. The views and the router wiring
were written after the services and checked by mutation: with `defaultErrorComponent` removed, the "inside the shell" test fails
(a page error then reaches the tenant route's panel, which has no shell around it).
Component tests in jsdom: `app/App/failure.test.tsx` (a throwing page shows the panel inside the shell with focus on the
heading; production shows no message and an id; the details are the shown text and match the template; Copy copies it; the id is
logged with the whole error; development shows the message; Try again recovers and a second failure takes a new id; Back to
overview resets; keyboard order; Reload asks the guard; a throwing shell draws the panel alone; a throwing toast region draws the
root fallback with no provider), `RouteFailure`/`ShellFailure`/`RootFailure`/`RootBoundary`/`FailurePanel` tests with axe in both
themes, `rootErrorOptions` against a real `createRoot` (the chunk boundary logs, a panel's error is logged once under the id it
shows), the router's options, and the repository (CSPRNG, eight bytes, build mode read when asked). The build mode is stubbed with
`vi.stubEnv('DEV', false)`, which Vitest supports for `import.meta.env`.
`apps/admin-console/e2e/failure.spec.ts` runs against the production image and ships no crash switch: the page failure is a
`page.route` answering the Signing keys chunk with a module whose page throws; the root failure is a `page.route` serving the entry
chunk with the toast region's label expression replaced by a throw, asserting the replacement happened so a changed bundle fails
the test. Both check the panel, axe in all four theme states, a phone's fit, focus, no message in the page, the logged id matching
the shown one, Copy against the clipboard, Try again drawing a new id, Back to overview, and Reload. The production bundle holds no
test hook: nothing was added to ship; `grep` for the test's own error text over a production build finds nothing.
`tests/lint/cross-package-reads.test.ts` lists `adapter/browser.ts` with no targets, because the check takes `import.meta.env` for a
path root.

**Cost.** A class component whose render returns `this.props.children` while nothing has failed: no extra render and no state
change on the happy path; the route panel and its hooks mount only on a failure. The entry chunk is 366.6 kB (117.6 kB gzip, Vite's
figure) before and 375.6 kB (120.9 kB) after; the entry plus the chunks the HTML preloads is 765.6 kB raw and 240.0 kB gzip before,
774.7 kB and 243.6 kB after (gzip -9; +9.1 kB and +3.6 kB). The panel, `CopyValue` and `ButtonLink` are static in the entry now,
since the root fallback must draw with nothing else loaded. That took the first load past `console-phone-chunk`'s
242,000 B (see the fix round for the budget).

**Screenshots** (`p4g-docs/console-failure-route-*` and `console-failure-root-*`, desktop and phone, light and dark; the root one
shows the Copy outcome after a click).

### Increment 31h, fix round

- **Copy that claimed things the code does not do** is gone. The route panel says "Changes you saved are kept; changes you had not
  saved on this page cannot be recovered" (the guard forgets a form when its page unmounts, so no other page holds unsaved work);
  `wording.test.ts` fails on any of "held", "restored", "asks first" or "each of them". The tour now says which buttons ask:
  **Back to overview** and **Reload the console** ask if another open form has unsaved changes; **Try again** does not, because it
  leaves nothing. A failing shell draws the panel alone with the same three buttons; only a failure above the router has the single
  Reload.
- **Focus after Try again** goes to `main` (`useRouteFailure` marks the retry and the panel's unmount focuses `#main`, ahead of a
  new panel's own heading focus if the page fails again). jsdom test and the new recovery e2e (`failure.spec.ts`: the page throws
  while a flag the test holds is set, draws once it is not; `main` is focused).
- **Announcement.** Focus moves to the heading, which a screen reader reads; only the one-sentence summary has `role="alert"`, so
  the buttons and the details block are not read a second time on insertion. Not verified with a screen reader here.
- **Dev-only label out of production.** `MESSAGE_LABEL` is named only inside `import.meta.env.DEV ? … : ''` in the adapter, which Vite
  folds away; `tests/lint/console-no-dev-text.test.ts` reads the built chunks for it.
- **Layout.** The in-shell panel has the page's block padding; the details block's Copy button is flush with the block's edge
  (`CopyValue`'s block form, shared). Screenshots retaken.
- **Failure inside the failure screen.** `FallbackBoundary` around `RootFailure`: the first error is logged under an id and
  `MinimalFailure` draws (tested by forcing `RootFailure` to throw).
- **Mutations, each killed by a named test:** removing `disableGlobalCatchBoundary` (`outsideRoutes.test.tsx`: every route panel throws,
  so the page error must reach the console's root fallback, not the router's "Show Error" panel); the `caughtBy` classification for
  the router's and the root boundary (`rootErrorOptions.test.tsx`, two tests); the guard on Reload (`failure.test.tsx`); the focus
  move (`failure.test.tsx`); the link that goes through the guard on Back to overview (`failure.test.tsx`, two tests).
- **CONSOLE_ROOT** consumers repointed at `shared/service/address`; the session re-export is gone.
- **`tests/lint/cross-package-reads.test.ts`** ignores `import.meta.env` (build mode, not a path); the empty-target entry is gone and
  three table rows pin it, including one where `import.meta.dirname` beside it still counts.
- **Budget.** The route-level pieces cannot usefully be made lazy: with `RouteFailure` and `ShellFailure` (which carry
  `useRouteFailure`, `overviewAddress`, `ButtonLink` and the route texts) behind `lazy()` in the router, the first load went from
  244,138 B to 243,569 B gzipped, 0.2 per cent, not the 2.2 kB the old budget needed, and it would cost a degrade path for a chunk that
  fails to load. The split was measured and not kept. The first load is now 244,911 B (the fix round added the minimal fallback and
  focus move: +0.8 kB), the entry chunk 377.9 kB raw, 121.7 kB gzip (Vite; 120.3 kB by `gzip` default); the budget is reset to that
  plus 5 per cent, 258,000 B, by the file's own convention, with the reason beside it. The entry budget (153,000 B) is untouched.
- **Docs coverage:** the tour covers a button that fails (nothing is drawn, the console in the browser holds the error) and the
  panel's real buttons; `tests/support/console-labels.ts` already holds every label the tour quotes.

### Increment 31i, the sign-in scene moves smoothly

A step used to switch at once. It now plays in stages, each overlapping the last: the nodes and their highlights ease
over 400 ms with one shared ease-in-out (`SCENE_EASE`), each route then draws itself over 700 ms starting 150 ms in, its
arrowhead lights as the line arrives, and the pass glides along the path from 600 ms. A step is held 2.5 s, 3 s for the
step that names the sign-in methods and 3.4 s for the return step, which runs two routes one after the other.
Only transform, opacity and stroke-dashoffset animate; nothing changes layout, and CLS stays 0.

- **Routes draw through a mask.** The lit dotted route is shown through a mask whose own path has its
  `stroke-dashoffset` transitioned, so the dotted look is the one the picture always had. The staged delays are inline
  per element, so reduced motion cancels them with `transition: none !important`: a transition with a delay and no
  duration still waits.
- **The pass glides.** `@keyframes` for a pass are sampled at eased times and run on a linear clock; an
  `ease-in-out` on each keyframe segment would have started and stopped at every sample.
- **One marker.** The stepper is a grid of seven equal columns, and a single soft-tinted pill slides between them with
  `transform`; its position is CSS alone (`data-marker`, the last step shown, so the marker stays on 7 when the scene
  returns to rest instead of sweeping back). Label colour never changes under it: the marker is a tint beneath dark
  text, not a solid fill. Each step shows a short label from the model on one line (the full label is the button's
  accessible name and contains the short one); below 1100 px the stepper shows numbers only. A thin line in the pill
  fills over the step's hold and exists only while the step runs, so resuming restarts it with the step's timer.
- **Captions hand over.** The reducer remembers the step it came from and how the move came about. A click shows its
  caption after 80 ms (the old one is fading out for 200 ms), so the box is never empty for more than about 120 ms; a
  timed advance keeps the staged 450 ms. Only a caption that was fully shown leaves: a move made while the last
  hand-over is still going lets nothing leave. A `settled` event after the hand-over drops the old layer from the page,
  so find-in-page and text queries meet each caption once. The box is one grid cell holding the layers and a hidden
  copy of the longest announcement, so it follows its text (WCAG 1.4.12 spacing, longer translated copy) and is the
  same height at every step; tests run it at seven widths from 375 to 1280 and under a text-spacing override,
  asserting it never overlaps what follows.
- **Reduced motion:** no transition and no animation in the scene, the stepper or the caption box; the old caption
  layer is `display: none`. Turning it on while the scene plays stops the autoplay.
- **Static frames.** `compare-landing.mjs` (now also capturing the scene alone) against the build before: at every step
  end the scene differs from before in at most 145 pixels, by one level of one channel (the lit arrowhead sits over a
  dim one that fades out, and the route passes through a mask); step 3 is identical. The controls differ by design.
- **Mid-transition frames** are in `docs/phases/p4g-docs/landing-motion-*`: pauses at 200, 450 and 800 ms of the step 3 to 4
  (desktop, light), 5 to 6 (desktop, dark), 6 to 7 (phone, light) and 3 to 4 (phone, dark) transitions, taken by setting
  every running animation's time. A tall element screenshot resizes the viewport and restarts the page's animations,
  so the capture viewport has to be taller than the section.
- **Cost:** landing chunk 14,381 to 15,161 gzip across the increment and its fix round. Lighthouse (12.6.1): simulated
  mobile 0.92 (LCP 3.4 s) twice, devtools mobile 0.97 (2.0 s), desktop 0.99 (0.9 s); CLS 0 throughout.
- **Stepper frames** at 900, 1000, 1100 and 1280 px are in `docs/phases/p4g-docs/landing-motion-stepper-*`.
- **Not done:** the glow behind the hub and the resting look of dimmed parts are unchanged, because static frames had to
  stay identical; only their transitions moved.

### Increment 31g, links between the pages and refusals in place

The sign-in, registration and reset pages could only be reached by typing their
addresses, and a refused account form left the form for a separate page with no way
on. Both are defects of the pages' own topic and are fixed here.

**Links.** The sign-in form offers _Forgot password?_ and _Create an account_ on the
first-factor step, each on its tenant setting (`reset_password_allowed`,
`registration_allowed`: the same two that make the pages answer 404, so a link is never
offered that leads nowhere). Registration, the reset request, their success pages and
the unverified-email page link _Back to sign in_; a pending action this deployment
cannot offer does too. A reset link that was used or expired offers _Request a new
link_ while the tenant still allows resets.

- **How the pending request travels.** As a `return_to` parameter holding the authorize
  path `restartAuthorizeLocation` rebuilds from the parked request, not as the
  authentication session id: that id is the sign-in form's CSRF defence and the page that
  mints it says it is never carried in a URL, and a POST button is not a link. The value
  is accepted in exactly one shape (this tenant's authorize path, a query, printable
  ASCII, no fragment, 4096 characters at most: `packages/account/src/service/sign-in-path.ts`)
  and carried through each page's form as a hidden field; `/authorize` validates it again
  from scratch. It holds what the browser's address bar already held at `/authorize`
  (client, redirect, state, challenge), no personal data and no session handle. It is
  absent when the request cannot be rebuilt (bound to a subject by a hint).
- **Mailed links.** Superseded by Increment 31m (below), as is the ruling that a state-less restart is accepted: the mailed link carries the key and
  nothing of the request, and the page it opens offers the way back only to the browser that
  parked the request. The reduced `return_to` this increment first mailed, and `mailedSignInPath`
  with it, are gone.
- **The verified, reset-done and actions-done pages have two honest states.** With a
  carried sign-in start they show the heading and a _Continue to sign in_ link built from
  it. Without one (a direct visit, a link issued with no request, a browser that does not hold
  the sign-in the link came out of) the heading stays and the text says what to do without implying a sign-in is
  waiting: _Return to the application you were signing in to and sign in again._ Verifying
  itself needs no session: the token is single-use and redeems in any browser.
- **How long the request lives, and what the link replays.** The parked authorization
  request lives thirty minutes by default, the tenant's `login_ttl_seconds` (1800;
  `expires_at - created_at` is recorded in Path A). A page-borne _Back to sign in_ link does
  not use it: the carried `return_to` is a path to `/authorize`, so following it starts a NEW
  request from the carried parameters, and it works when the original is expired, consumed or
  reaped (tested: the parked rows deleted, the same `return_to` still opens a fresh sign-in
  form). The scenario `return-to-app.spec.ts` asserts that the page-borne links keep the
  original `state` (registration and reset, each after a refused first attempt, so the hidden
  `return_to` is shown to survive a re-render, and the code exchanging with the PKCE verifier).
  What a MAILED link does is Increment 31m's.
- **A return-to-the-application link.** `client_oidc_config.client_uri` exists (registration
  metadata, RFC 7591, set through the admin API and shown on the consent page as _About
  <client>_), but a mailed link holds no client id for a page to read it by unless the
  reduced `client_id` is parsed from `return_to`. Not built.
- **No request, no link.** A visit with no `return_to`, and a link an administrator issued
  (no application started it), has nothing to go back to, and no tenant-level sign-in
  address exists (sign-in needs a client). Those pages show their own next step only. The
  place to return to for an administrator-issued link is placed on P4f in the roadmap and in
  the P4f row of section 11: its application-initiated actions give such a link a client.
- **Bound.** The sign-in page sends `return_to` only while the rebuilt path fits
  `MAX_SIGN_IN_PATH_LENGTH` (4096); past it the links are offered without one. Percent-encoded
  into a query a path is at most three times as long, about 12 KiB of the 16 KiB Node allows
  for a request line and headers together. The margin, about 4 KiB, is shared with every
  header, cookies included: a request whose headers overflow it is answered with 431
  whatever the link, and a path at the bound is a rare worst case, since ordinary rebuilt
  paths are a few hundred bytes.
- **Left as they are, and why.** A closed registration or reset page stays an empty 404
  (`reply.code(404)`: it must not say whether the tenant exists or what it allows; the
  unknown-address page of increment 31e is where a browser sees a branded one). The
  throttle page offers no link because it is decided before any read (its own comment).
  A used or expired _verification_ link offers none: there is no way to ask for another
  one (the page's own sentence says to), which is a missing resend flow, placed on P4f in the
  roadmap and in the P4f row of section 11.

**Refusals in place.** Registration, the reset request, the reset form and the actions
form now come back as the same form with status 400 (500 for the two that cannot send
mail, which stay pages with _Try again_). The sign-in, authenticator, recovery-code and
change-password pages already re-rendered; all of them now share one shape: one
`role="alert"` block above the form whose entries carry ids, each field at fault is
`aria-invalid="true"` and `aria-describedby` its entries, and the first field at fault
has `autofocus`.

- **Focus and announcement.** `autofocus` on the first invalid field, no script: it works
  without JavaScript, it puts the cursor where the next keystroke belongs, and the one
  `role="alert"` block is the single live region (the field's description reads the same
  entry again only where the person is working). Focus on the alert itself was rejected:
  it announces twice (alert and focus) and leaves the cursor away from the field.
- **Messages sit in the alert, not under each field.** One block above the form keeps the
  card width constant and nothing moves after load (every re-render is a new document, so
  there is no layout shift to reserve space for); the entry ids give each field its own
  description. The stylesheet adds only the invalid border and the `.links` row.
- **Kept and not kept.** Username and email come back (bounded to 254 code points, and
  not at all when they hold a bidirectional control, which is what the account refuses);
  passwords, codes and recovery codes never do. The login form's own echo is unchanged.
- **Account enumeration.** Registration told a person that a username or an address is
  taken before this increment (400, one sentence each) and still does, in the same words,
  now beside the field. That is the existing behaviour and no ADR decided otherwise;
  making the address case neutral needs a mailed answer, which a tenant with
  `verify_email` off cannot give. Flagged for the controller as a P2a-topic question; the
  reset request stays byte-identical for a known and an unknown address, `return_to`
  included (tested).

**Status and headers.** Unchanged: 400 for refusals, 200 for the sign-in and enrolment
re-renders as before, every page through `sendHtml`/`sendVerificationHtml`, `no-store`.

**Queries per path.** Registration, reset request, reset form and actions form
re-renders: the same as the refusal page they replace (the tenant read, then the
usecase's own transaction), none added. The sign-in page: the tenant read now selects
two more columns, and the parked request `continuation` already loads supplies the
return path, none added. Used or expired links: one indexed read of the token's type in
the transaction that already peeked (three statements, was two). The unverified-email
page: the tenant and parked request reads (two point reads, was none), once per refusal,
behind the throttle; every other page that gained a link already had the request loaded.

**Searched and reused.** Reused `restartAuthorizeLocation`, `continuation`, `pageHeaders`
wrappers, the `escapeHtml`/`bdi` helpers, `echo` bounds from the login form, the
catalogues and their `en`-only shipping. The four package shells stay one text
(`instrument-reach.test.ts`), so `links` lives in each; the field-state helpers are one
file per package (`form-error.ts`) for the same reason.

**Gallery.** Added `signin-links`, `registration-required`, `registration-weak`,
`registration-taken`; `registration-failed` is gone (the page no longer exists);
`reset-request-failed`, `reset-weak`, `email-unverified`, `reset-link-failed`,
`totp-enrolment`, `update-password-violations` and `second-factor-totp-error` were
captured again. Each ran through axe in both themes, at the phone width and at one card
width in `server-pages.spec.ts`, and was looked at.

### Increment 31m, a mailed link resumes the sign-in it came out of

**The defect (reproduced by the owner).** Forgot password, the mailed link, a new password,
_Continue to sign in_, sign in: the console showed _Sign-in failed_; _sign in again_ then loaded the
console signed in. Increment 31g mailed a reduced `return_to` with no `state` and no `nonce`, so
the link restarted `/authorize` without them. Increment 31g's ruling was that a state-less restart
is OIDC-compliant (`state` is RECOMMENDED, OIDC Core 3.1.2.1), which is true and beside the
point: the server sign-in succeeded and the SSO session existed, but the console gateway's callback
requires the `state` it bound to its own login cookie (`takeLogin` in
`packages/console-gateway/src/usecase/complete-login.ts`) and refused a callback that had none.
Any application that checks its own `state` or `nonce` fails the same way, and that is most of
them. **That ruling is superseded**: a mailed link never restarts a request that lacks the
application's own `state` and `nonce`.

**What tied a browser to its parked sign-in before this increment: nothing.** The parked request is
a row in `authentication_sessions` (the ORIGINAL authorize parameters, `state`, `nonce` and PKCE
challenge among them: `PendingRequest`), and its id reached the browser only as the sign-in
form's hidden `auth_session_id` field, which is also the form's anti-forgery value. There was
no cookie: the first cookie a browser got from `/authorize` was the SSO session's, after a
login. So a mailed link could not tell the browser that parked a request from any other.

**The decision.**

- **A handle in a cookie.** When `/authorize` parks a request that shows the login form or the
  account chooser, the response sets `odudu-sign-in` (`__Secure-odudu-sign-in` under TLS):
  `<authentication session id>.<256-bit secret>`, `HttpOnly`, `SameSite=Lax`,
  `Path=/tenants/<tenant>/`, `Secure` under TLS, `Max-Age` the tenant's `login_ttl_seconds`.
  The row keeps `browser_secret_hash` (sha256 of the secret, compared in constant time), so a
  database read yields nothing a cookie can be forged from. `packages/authn-flows/src/service/sign-in-handle.ts`
  holds the name, attributes, generation and parsing in one place, beside the session cookie's.
  The tenant's path scope rules out the `__Host-` prefix (it requires `Path=/`); `__Secure-` is
  the strongest prefix that allows a path.
- **A reference beside the token.** A reset or verification link requested from a page that
  carried `return_to` stores `authentication_session_id` in its `action_tokens` row, only when
  this browser holds that sign-in AND the request the page carried is the one the cookie's session
  parked (two tabs share one cookie, which names the later; the earlier tab's form carries its own
  request, they differ, and no link is tied to a request the person did not ask from). The mailed
  link is `…/action-token?key=…` and nothing else: no `state`, no `nonce`, no `return_to`, no
  reference.
- **Resuming.** The token page (form, done page, spent-link page) offers _Continue to sign in_
  only when this browser's cookie names that very session, the secret matches its hash, and the
  session is live (`expires_at` in the future, `consumed_at` null). The link is the authorize path
  rebuilt from the PARKED request (`restartAuthorizeLocation`), so it carries the original
  `state`, `nonce` and challenge, and `/authorize` validates it from scratch: the page never
  redirects, it renders a link built from a row. Followed, it is a fresh request equal to the
  original, which a state-checking application accepts. In every other case (another browser,
  another tab's sign-in, expired, consumed, no cookie, an administrator-issued link, a request
  that cannot be rebuilt because a hint bound it to a subject) the page shows the no-link text
  (_Return to the application you were signing in to and sign in again_, or its reset variant) and
  never a link.
- **`mailedSignInPath` and its allowlist, and the token pages' hidden `return_to`, are removed.** Nothing
  else used them (`git grep -n mailedSignInPath` and `return_to` in the token renderers). The
  page-borne `return_to` of the registration and reset forms (same browser, opened from the
  sign-in page, the full authorize path with its state) stays as it was: it is also how a
  request is matched to the cookie's session above.

**CSRF and fixation analysis.** The cookie authorises no write and is not a login credential. The
login form's CSRF defence is unchanged: the posted `auth_session_id` must name a live session, and
the cookie is neither required nor consulted there. The cookie is read in exactly two places, to
record a reference when a link is mailed and to decide whether a token page shows a link.

- _Planting._ An attacker who can set a victim's cookie (a sibling subdomain, or a network position
  on plain HTTP; under TLS the `__Secure-` prefix refuses a non-`Secure` set) names a session the
  attacker parked. At the mailing step the victim's own form carries the victim's request, which
  differs from the planted session's request, so no reference is stored. At the token page the
  victim's token names the victim's session, which differs from the planted one, so no link is
  shown. The attacker gains nothing and the victim sees the no-link text.
- _An attacker's request for a victim's address._ The attacker files a reset request for the
  victim's address, holding their own parked session, so the token names the attacker's
  session. The mail goes to the victim. The victim's browser holds no cookie for that session, so
  the page shows no link. Before this increment the same mail carried a state-less `/authorize`
  path chosen by the attacker; it carries nothing now.
- _Stealing._ The cookie is `HttpOnly`; the secret never appears in a page, a URL, a log
  (`logger.ts` allowlists headers, and neither `cookie` nor `set-cookie` is on it) or an audit
  row.

**Security properties.** The reference (the session id in the token row) is only ever read
server-side; the secret is 256 bits; the token page's answer for an unknown, foreign, expired or
absent reference is the same bytes (tested: two references that name nothing and a token that names
none give one body). Tenant isolation: `authentication_sessions` and `action_tokens` are RLS tables,
the lookups run under the tenant of the request path, and a cookie or a token row naming another
tenant's session reads as none (probes: `packages/authn-flows/tests/sign-in-binding.int.test.ts`,
`apps/server/tests/mailed-link-resume.int.test.ts`, `packages/account/tests/action-tokens.int.test.ts`).
The sign-in consumed by a successful login, and one past `login_ttl_seconds`, stop being held.
Resetting a password still logs nobody in and sets no cookie. The reset request answers a known and
an unknown address with the same bytes; the held-sign-in read happens before the address is looked
up and whatever it names.

**Queries per path.** Counted from the code. `/authorize` login form: none added (the secret's hash
is written by the insert that parks the request). Reset request and registration: one
primary-key point read of `authentication_sessions` (in its own transaction) when the page
carried a request and a cookie (none otherwise), then the usecase's own statements, one column
wider on the token insert. Token page: the token read it already made, plus one point read of the
session only when the token names one AND the request carries a readable cookie. A request with no
cookie costs no connection for it (`findHeldSignInIn`). Nothing is unbounded; the cookie value is
bounded at 36 + 1 + 128 characters.

**Shared computers.** Someone using the same browser profile can continue a parked sign-in until it
expires. The cookie is HttpOnly and lives only as long as the login lifetime, and the handle is
expired when the sign-in completes (a finished login or consent), when it names nothing.
Continuing only restarts that application's own sign-in: it grants nothing.

**Duplicates.** A planted duplicate of the cookie (another `Domain` or `Path`) cannot hide the real
one: every pair of the name is tried and each candidate is still checked against its row.

**Left as it was, and why.** An administrator-issued link names no sign-in and still offers none:
there is no application behind it, placed on P4f. A link opened in a different browser cannot
resume: the browser that holds the sign-in is the only one that can complete it.

**Found on the way, outside this increment's topic.** `apps/server/src/app.ts` did not pass `tls`
to `oidcRoutes`, and nothing sets it from `ODUDU_TLS`, so the SSO session cookie is served without
`__Host-` and without `Secure` even with `ODUDU_TLS=true`. `buildApp` now takes `tls` (default
`false`) and hands the one value to both the login page that sets the sign-in cookie and the pages
that read it, so those two cannot disagree; `serve.ts` does not set it, which keeps today's
behaviour. Wiring `ODUDU_TLS` through changes every deployed cookie's name and is a decision for
its own increment.

**verified:**

- `node_modules/.bin/vitest run --project integration apps/server/tests/mailed-link-resume.int.test.ts packages/authn-flows/tests/sign-in-binding.int.test.ts packages/protocol-oidc/tests/sign-in-handle.int.test.ts packages/account/tests/sign-in-resume.int.test.ts`
  (real PostgreSQL). Mutation check: with the secret comparison and the liveness test removed,
  six of these fail (forged secret, expired, consumed, at both levels).
- `apps/admin-console/e2e/mailed-link-resume.spec.ts`: the console as the client (its gateway
  requires `state`): reset, and verification, in the browser that started the sign-in, then
  _Continue to sign in_, sign in, the console loads with no refusal; a different browser context and
  a lapsed sign-in show no link. `return-to-app.spec.ts` adds the ID token's `nonce` check for an
  application that verifies it, and the different-browser case.

### Increment 31q, one setting for every cookie

**The defect.** `serve.ts` never passed `ODUDU_TLS` into `buildApp`, and `buildApp` never handed a
`tls` value to the OIDC routes, so the SSO session cookie was `<tenant>-session` without `Secure` and
without `__Host-` even with `ODUDU_TLS=true`, in production. The console gateway decided its own `tls` from
the base URL's scheme, so two settings could disagree. Found while adding the sign-in cookie in 31m.

**The fix.** `apps/server/src/app-deps.ts` (`appDepsFromConfig`) is what `serve.ts` hands `buildApp`, and
sets `tls: config.ODUDU_TLS`. `buildApp` gives that single value to the OIDC routes (the SSO session and
remember-me cookies, the sign-in cookie), to the pages that read the sign-in cookie, and to the console
gateway, whose `tls` is now a required dependency instead of the base's scheme. Boot refuses both
disagreements: `ODUDU_TLS=true` with an `http` base (as before) and `ODUDU_TLS` off with an `https` base
(new), while the console is on. What the server does when `ODUDU_TLS=true` but a request arrives over http
(a proxy that does not forward its scheme) is unchanged and not guarded: the cookies carry `Secure`, a
browser may refuse to keep them, and sign-in fails visibly.

**Every cookie writer found** (`git grep` for `set-cookie`, `Max-Age`, `SameSite` in packages and
`apps/server/src`): authn-flows `sessionCookies` and `clearedSessionCookies` (SSO session and persistent),
authn-flows `signInHandleCookie` and its clearing, console-gateway `loginCookie`, `restartCookie`,
`sessionCookie` and their clearings, and the theme cookie the console's script writes. The docs and
instrument routes set none. The theme cookie is `Path=/; SameSite=Lax` with `Secure` when the page is https, no
prefix (a preference the script owns, named by the server pages), not `HttpOnly`.

**Checks.** `tests/cookies/cookie-writers.test.ts` holds every writer, under TLS and without, to prefix,
`Secure`, `HttpOnly`, `SameSite`, `Path` and no `Domain`. `apps/server/tests/cookies-under-tls.int.test.ts`
builds the app through `appDepsFromConfig` with `ODUDU_TLS` on and off and reads the real `Set-Cookie` of
the sign-in handle, a remember-me sign-in, the OIDC logout and the console's login, session and logout.
`tests/lint/cookie-writers-follow-tls.test.ts` fails on a helper called without `tls` or with a literal
and on a hand-built `set-cookie` header; it cannot see a wrongly valued `tls` variable, an aliased helper
or a spread. `tests/docs/cookie-names.test.ts` reads the configuration page's Cookie names table against
the helpers. The local stacks stay plain http: the development and quickstart composes run with
`NODE_ENV=development` and no `ODUDU_TLS`, the conformance stack sets it with an https base.

**Cookie names change under TLS** (`__Host-<tenant>-session`, `__Secure-odudu-sign-in`, `__Host-odudu-console`).
Nothing is public yet, so every signed-in browser signs in once more.

### Increment 31r, four defects the WordPress run found

**The issuer was read from the request.** `issuerBaseFor(request)` built the issuer from the request's
protocol and `Host` (and `X-Forwarded-*` when the proxy is trusted), so a proxy that dropped the port gave
`iss` without it, and a forged `Host` was reflected into discovery, `iss`, every token's `iss` and the
audience the server checks. It is the single function every place that states or checks the issuer calls
(discovery, the `iss` of the authorization response and ID token, introspection, revocation, userinfo, logout,
the private_key_jwt audience, token exchange, and the admin API's routes through `tenantIssuerFor`); no other
code builds an absolute URL from a request (mail links, the console and passkeys already used
`ODUDU_PUBLIC_BASE_URL`). Now `configureIssuerBase` (protocol-oidc) decorates every request with the configured
base, spelled as a request's authority would be, and `issuerBaseFor` prefers it; `buildApp` decorates the
whole app, so the OIDC routes and the admin API agree. With no `ODUDU_PUBLIC_BASE_URL` (local development)
the issuer is read off the request as before. Production already refuses to boot without the variable (the
passkey relying party guard); its message now names the issuer. `ODUDU_TRUST_PROXY` means what it did.
The OIDF conformance plans run only in CI; they reach the server at `https://odudu` with
`ODUDU_PUBLIC_BASE_URL: https://odudu`, so the configured issuer equals the one the suite derived from `Host`
and discovery is unchanged there.

**The https-base guard is gone.** The console refused an `https` base while `ODUDU_TRUST_PROXY` was off, because
the gateway's in-process calls needed a trusted `x-forwarded-proto` to see the https issuer. With a configured
base the issuer never reads the request, and nothing else reads a request's scheme (`git grep` for `protocol`
and `x-forwarded` in `packages` and `apps/server/src`: only `issuerBaseFor`'s fallback, used when no base is
set, and the proxy-trust uses of the client address and certificate header). Cookies take `Secure` from
`ODUDU_TLS`. So the guard had no reason left, and neither had the gateway's forwarded headers; both are removed,
an integration test signs the console in over an https base with proxy trust off, and the docs say the setting
decides client addresses and rate limits alone. A base with a trailing root dot is normalised in the config, so
the gateway's assertion audience equals the server's issuer. Per-tenant custom domains are not supported:
placed on P4b (roadmap and section 11).

**The conformance stack's public base is `https://proxy`, because the suite reaches the server through the
proxy by that name.** Increment 31r first set it to `https://odudu`, from a comment that said the suite reaches
nginx's `server_name odudu`; the plan files fetch discovery from `https://proxy/...`, and `odudu` resolves on the
suite's network to the app container (443 refused). Once the issuer stopped following `Host`, the Config OP plan
failed ("issuer ... not consistent with the location the discovery document was retrieved from"). The compose
file, nginx's `server_name`, the proxy certificate's names, the console check and the README now name `proxy`,
and any plan file, certificate or check script must name the same host as `ODUDU_PUBLIC_BASE_URL`. The docs
route's file-count test passes a small limit instead of writing 5,001 files: the route takes optional limits.

**`seed client` and `seed scope` help said "create or update".** Both fail when the thing exists
(`seed_conflict`). The help now says so and where to change an existing client; no update mode was built.

**`seed user` and `seed profile` take `--email-verified`**, as `seed profile` took `--phone-number-verified`.
`seed user` refuses it without `--email`; `seed profile` refuses a user with no address. Both set it through `setVerification`, as the phone flag does, so `updated_at` moves.

**OAuth errors say what went wrong.** A missing PKCE challenge now redirects with
`error_description=code_challenge is required`; each refusal of `/authorize` (the response type, the challenge
and its method, `prompt`, `max_age`, `claims`, `id_token_hint`, a repeated parameter) says so in a few static
words, and every other authorization and token error carries one fixed sentence per code
(`OAUTH_ERROR_DESCRIPTIONS`, printable ASCII, never built from the request; `invalid_grant` names no cause).
`/introspect` and `/revoke` share the token endpoint's sentences. The errors reference lists them.

## Increment 31j: deleting and restoring built-in scopes

**Decision.** A built-in scope (a name in `TENANT_DEFAULT_SCOPE_NAMES`, the set provisioning
creates) is deletable, Keycloak-style, but only when the request names it again. The
confirmation is `?confirm=<scope name>`, the same parameter `DELETE /admin/tenants/{tenant}`
takes for a tenant, rather than a new `confirm_builtin` flag: a script has to know the name,
and the console already makes a person type it. Without it the answer is `422`
`builtin-scope-confirmation`, its detail naming the scope and the counts. `428` was rejected:
the console gateway and every `If-Match` client read it as "send the precondition header" and
report it as their own defect. `openid` stays `409` whatever `confirm` says. The ceiling check
runs before the confirmation, so a caller who may not delete is not asked to confirm.

**Audit.** `scope.delete` rows, allowed or refused, carry `builtin`, `client_assignments` and
`role_mappings` (plus `counts_capped` past the ceiling). `scope.restore_builtins` writes a row
naming what it created; a restore that creates nothing writes none.

**Restore.** One function, `restoreBuiltinScopes` beside `provisionTenantDefaults`, creates a
missing built-in through the same `createDefaultScope` provisioning uses, so the shipped
settings have one author. It touches nothing that exists, brings back no assignment or role
mapping, and refuses whole (nothing written) at `SCOPE_LIMIT` or at the 200 scopes marked for
new clients, checked before the first insert. Reached by `POST …/scopes/restore-builtins`,
`GET …/scopes/builtins` (what is missing) and `odudu seed restore-scopes --tenant`.

**Console.** The delete dialog reads `GET …/scopes/{id}/impact` each time it opens (the old
first-page client read is gone) and says how many clients and roles go and that the scope is
built in. The typed name was already required for every scope, so it is unchanged and is what
the console sends as `confirm`. The Bound mappers tab shows the registry's declared mappers
ticked and greyed, "Used because nothing is bound", until one is bound; ticking another binds
only that one.

**Queries per path.** Impact: one scope read and two bounded counts (`limit cap + 1` over
`client_scope_assignments_by_scope` and the `client_scope_roles` key), whatever the tenant
holds. Delete: those plus the delete, constant. Builtins: one read over the name index.
Restore: O(8) inserts under the tenant lock; a second call is one read.

**Searched and reused.** `countAtMost`, `COUNT_CAP`, `CountResponse`, `useRead`,
`useConfirmedRemoval`, `ConfirmDialog` (`settled` holds the restore when nothing is missing),
the tenant delete's `confirm` convention, `deleteWarning.ts`'s mapper sentence.

### Increment 31o, passwords follow NIST SP 800-63B-4

**What the standard says.** `verified: https://pages.nist.gov/800-63-4/sp800-63b.html` (3.1.1.2, read in
full by the controller): at least 15 characters for a password used alone, 8 where it is one of two
factors; accept 64 or more; Unicode accepted and NFC-normalised before hashing; no composition rules and
no periodic change; a blocklist of common, expected and compromised passwords on every set or change,
with the reason given; never truncated. The owner ruled the minimum soft (bounds stay 8 to 256) and tied
"one of two factors" to the tenant's existing `otp_required`.

**Writers.** Every writer of a user's password is bound by one `evaluatePassword`:
registration, reset redemption, an actions link that sets a password, the change-password action,
`odudu seed user`, `odudu seed admin --password` and `odudu init`, whose prompt and `ODUDU_ADMIN_PASSWORD`
reach `seedAdmin`. Exempt on purpose, and said so: the one-time password the admin API issues and the one
`seed admin` and `init` generate (random, 32 characters, and owing a change on first use); a client secret
and a recovery code (generated, hashed with `hashPassword`, never typed as a password). Nothing else takes
a plaintext password: the tenant import and export carry none (`tenant-document.ts` has no credential
field), and neither the admin API nor the console chooses one (roadmap decision).

**Common-password list.** `packages/domain-identity/src/service/common-passwords-data.ts`: the entries of
eight characters or more among the first 100,000 lines of `Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt`
in SecLists at commit `4c0fd59432ab8508edc23b3c880127edb12e34d5`, MIT, Copyright (c) 2018 Daniel Miessler
(`LICENSES/MIT-SecLists.txt`, `THIRD-PARTY-NOTICES.md`). Shorter entries are dropped because the database
CHECK holds the minimum at 8 or more, so they could never be reached; entries holding a backtick, a
backslash or `$` (two) and three that a repository-wide word check refuses are dropped too (five entries in all). Lowercased,
de-duplicated: 38,446 entries, 355 KB of source. `verified: node --expose-gc`: loading the module costs
11.1 MB of heap, once per process, and `isCommonPassword` takes 0.66 microseconds. The comparison is
whole-password, after NFKC and lowercase, against the list and against the tenant name, the username, the
email name and `odudu`. A password that merely contains an entry is not refused.
`verified: curl` on the source file's raw URL for the licence, the file and the commit.

**NFC transition.** `hashUserPassword` hashes `plain.normalize('NFC')`. Migration
`0103_password_hash_normalised.sql` adds a nullable `user_credentials.hash_nfc`: true on every hash written
since (insert, set, rotate), null on one made before, with no rewrite. A login verifies the normalised form
first and tries the form as typed only for a null row and only when it differs from the normalised form
(`matchUserPassword`), so a marked account costs one Argon2id verification whatever an attacker types, and an
unknown username (the dummy hash, marked) costs one as well. When a null row matches, `passwordStep` returns a
`commit` that `advance` runs once the sign-in is known to be that subject's: a match as typed rehashes from the
NFC form, and any match sets the marker (`upgradePassword`, a compare-and-swap on the hash read, `created_at`
untouched so password age is unaffected). The asymmetry stands, tested: a legacy decomposed hash does not accept
the composed form until it has been upgraded. Checks by somebody already authenticated (the reuse check,
the reset's unchanged check, the seed) use `verifyUserPassword`, which tries both forms. A wrong legacy
password costs two verifications when it is non-NFC, which leaks that an account is unmigrated by timing and
nothing else. `evaluatePassword` counts length and the 256 maximum in code points of the normalised form;
`readPasswordField` bounds the raw form first, and the comment there states the two cases where they differ
(tested: a decomposed password of 257 code points is refused at the form, one of 256 that grows when
normalised is refused by the policy).

**New-tenant default.** Migration `0102_password_min_length_default.sql` sets the column default to 15;
bounds, existing rows and `otp_required` are untouched (`password-min-length-default.int.test.ts` migrates
to 0101, inserts, migrates on and reads back 8, 12 and 15).

**Console note.** `passwordConformance(minLength, otpRequired)` in `@odudu/contracts/admin` is the one
function; the console words it (`passwordNote`) as a note beside the minimum, a warning below 15 without a
second factor and a plain note when a second factor covers it. Nothing blocks a save. A
`password_policy_notes` field on the settings read was not added: it would change the OpenAPI document and
its transcript for no reader the console does not already serve.

**Pages.** Registration, the reset form, the actions form and the change-password page list the tenant
minimum, each enabled character rule and "Not a common password" as plain markup; one script of 1,422
bytes (`PASSWORD_HINTS_SCRIPT` in `@odudu/kernel`, no request, no dependency) ticks them as the password
is typed (code points of the NFC form, the same character classes as the server), says a short
summary ("3 of 4 rules met") in a polite status line 800 ms after typing stops, and reveals a show toggle.
The status line is visible, in the head row that already has the toggle's height, because the page
stylesheet is at its line budget and a visually hidden class would not fit; it also helps everybody. The
toggle keeps one label, "Show password", and states itself with `aria-pressed`: a label that changes and
a pressed state together read as two statements. The field carries `spellcheck="false"`,
`autocapitalize="off"` and `autocorrect="off"`, so a revealed password is never seen by a spellchecker.
The page returns the script's nonce in `RenderedPage.script`, so `pageHeaders` derives `script-src`; a unit
test per package reads it back. Without the script the toggle stays `hidden`, and the head row is as tall
as the toggle, so nothing moves (`server-pages.spec.ts` compares the two heights).

**Verified in a browser.** `server-pages.spec.ts` runs axe in both themes at a phone and a card width on
`registration-hints-unmet` and `registration-hints-met-shown`, and the existing registration, reset and
change-password states carry the list. The settings spec checks the note and axe on a minimum of 12. The
browser refuses a password shorter than `minlength` before the server sees it, so the specs that used to
post `a` for the policy's wording post a listed password of 16 characters instead.

**Wording of the refusal.** "That password is too easy to guess. Choose a different one." for every blocklist and
context refusal, since a password equal to the tenant's name is not "common" to the person.

**Refusals are not audited.** Registration, reset, actions and change-password refusals write no audit
row today (only the successful change does), so the common-password refusal does not either, in step with
the other policy refusals. A problem type in the admin API's errors reference is not added: no admin route
accepts a password a person chose, so none can refuse one.

**Queries per path.** None added. The check is a lookup in memory. The change-password page reads the
tenant's rules from the row `findTenant` already reads (five more columns, no second query), and the
account pages take them from the tenant lookup they already make. `pnpm test:plans` is unaffected: no
route, index or statement was added.

**Sign-in withheld until the second factor exists.** `verified: reading login-submission.ts`: with
`otp_required` on, a subject with no authenticator app is owed `configure-totp`; the login branch for a
pending action sets no session and issues no code, and the parked sign-in finishes only once the action
is completed. A passkey sign-in is never asked (`otpApplicable`). The docs say both.

**Transcripts re-derived against a live stack** (project `odudu-p4g-31o`, port 3187), listed in
`apps/docs/content/en/contributing/transcripts.md`: Getting the token, Self-registration, Following a
required-actions link, Password expiry and changing a password and Password reset (their page documents
and refusal sentences), and the settings, range and export transcripts (a new tenant's 15). The OpenAPI
response size is unchanged: no description in the contract changed.

**Searched and reused.** `readPasswordField`, `evaluatePassword` and its `PolicyViolation` shape,
`invalidAttributes`, the catalogue and its pinned-wording lint, `RenderedPage.script` and `pageHeaders`,
`scriptNonce`, `Note`, `numberOf`, `PLACED_ELSEWHERE`'s Sign-in flow name. One thing moved: the e2e
`COMMON_PASSWORD` lives once in `page-inspection.ts`.

**Placed.** A breached-password check (a lookup against a leak list) stays with P4f; the roadmap, section
11 and `docs/NEXT.md` say "a breached-password check" now. Required username or email stays with the
declarative user profile.

### Increment 31k, a taken address is not named

**With `verify_email` on, a registration creates nothing until its link is confirmed.** The form asks for
username, email, password and its confirmation. The request is a `pending_registrations` row (username,
address, the Argon2id hash made before the transaction, expiry; one row per tenant and lower-cased
address, a repeat replaces it) and one mail whose link opens a page naming the account with one button.
A held address writes no row and mails its holder. Both answer 201 "Check your email", and neither holds
a username, so asking for one username twice (first with a held address, then a free one) answers as for
two free ones. A review found that two-request oracle in the first design, which created the account
straight away; deferral closed it. The link's GET reads the key and writes nothing, so mail scanners
cannot spend it; the POST takes the row, locks the address, re-checks username and address and creates
the verified account in one transaction. A username taken meanwhile says so (409); anything else wrong
with a key reads as "can't use this link". With `verify_email` off nothing changes.

**Mitigations for a registrant who is not the owner,** in place of asking for the password at the link
(rejected: the standard form asks at the form): a later registration replaces the pending row, the key
is single use and expires, the mail and the page say what the link does and show the account name, and a
password reset now ends every session and revokes every grant of the account. ADR 0037 states the
residual risk.

**Hash at rest.** The pending row holds the Argon2id hash until the link is used or the row is reaped
(`verify_email_ttl_seconds` plus the action-token retention window), as protected as the credentials
table: same database, same row-level security.

**Case and lock.** Matching an address is ASCII case-insensitive (`users.email_search`, served by
`users_email_search`). No unique index on the lower-cased `users` column: existing data may hold variants
and a migration that fails on them is worse. Every creator takes `pg_advisory_xact_lock` on
(tenant, lower(address)) through `lockEmailForCreation` (composeUserSubject, so admin and seed too, and
the link's transaction), and a test holds that a creation waits for one already in flight.

**Mail bound.** One in-process sliding window per kind (registration link, held-address notice, reset),
tenant and address: 3 an hour, at most 100,000 addresses a kind, 3 timestamps each, coldest evicted, one
lookup per call, no timer. It decides only whether a mail is queued, never the answer; a refused
registration mail leaves an earlier pending request alone. A restart clears it and N replicas allow N
times as much (P11 owns sharing it).

**Queries per path** (reads / writes after the tenant lookup). Free address: 2 / 2 (pending upsert, mail).
Held address: 2 / 2 (audit row, mail). Argon2: one hash for every request that passes the policy, before
the transaction, on both paths; a request the policy or the confirmation refuses is answered before
hashing. Link visit: the tenant lookup and one indexed read of the key. Link press: delete-returning,
advisory lock, two lookups, subject, user, defaults (2 reads), verified flag, credential, audit row, one
transaction. Every statement is an index scan in the plan inventory at 200,000 subjects. Measured over
200 alternating requests per path on a local stack: free median 38.2 ms, held 38.3 ms; the paired
difference has a median of 0.1 ms against a spread of 11 ms, which is noise.

**Audit.** `account.registration_duplicate`, `refused`, reason `already_registered`, naming the account;
bounded by the per-origin throttle (ADR 0037's amendment).

**`odudu seed client --consent-required`** creates a client that asks for consent, so the consent screen and
its two refusals are reproducible from the command line. The `consent_required` and `access_denied` lines in
the refusal transcripts are captured against such a client.

## Increments 32 and 33: the README front door and the community files

**The README is 101 lines, from 2,023.** Each `##` of the old README has a home
on the site, and the facts the tests read moved with the prose.

| Old section                    | Lines     | Home now                                                                                                                                                |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                         | 22-764    | `concepts/`, `guides/`, the request paths and the roadmap's Shipped section; a script found every backticked name of it on the site bar a few internals |
| Running it, credentials to try | 765-1051  | `contributing/run-from-a-checkout.md` (moved, wording kept)                                                                                             |
| Running it, sign somebody in   | 1052-1292 | `reference/transcripts/request-paths/bootstrap.md`, already there                                                                                       |
| Running it, Compose and init   | 1293-1460 | `reference/transcripts/first-start.md` (moved), checked by `tests/docs/first-start.test.ts`                                                             |
| Running it, seed to reap       | 1461-1800 | the request paths and `operating/upgrading.md`, already there; the back-channel sender paragraph and the throttle ceilings moved into two request paths |
| Why not Keycloak               | 1827-1838 | `introduction/compare.md`; the agent paragraph is dropped: agents are P5 and the README claimed what is not built                                       |
| Conformance                    | 1839-1858 | `security/index.md` (Config OP passes, Basic OP is not claimed, ADR 0016)                                                                               |
| Deploying                      | 1859-1977 | `operating/deploying.md`                                                                                                                                |
| What is not built yet          | 1978-2019 | the roadmap's Next and Later; "Helm chart or manifests" gained its roadmap line under P11; the history paragraphs stay in git                           |
| License                        | 2020-2023 | `LICENSING.md`, linked                                                                                                                                  |

The tests that read the README now read the pages that hold the facts:
`brute-force`, `config-defaults`, `login-step-resource`, `required-action-order`,
`session-cookie-shape`, `session-lifespans` and `error-codes` dropped it from their
lists; `throttle` and `retention-schedule` read the request paths;
`docs-route` reads the transcript and the deploying page; `not-built-yet` reads
the roadmap; `discovery` lost its README excerpt, since the request paths hold the whole
document; the structure, references and phase floors for the README are 1, 0 and 0.
The init refusal named "the README's Deploying section"; it now names Deploying in
the Operating section, and `quickstart/compose.yaml` says the same.

**The hero GIF.** `pnpm docs:gif` drives the console in dark mode through the
capture's pinned browser, guard and routes (a request that issues a secret is aborted,
and a filled password field is never photographed): sign in, open Clients, create
`my-app`, see it listed. 29 frames at 800 x 560, 9.2 s, one 128-colour palette,
992 KB, `docs/media/console.gif`. `verified: ODUDU_REVISION=unknown SHOTS_PREBUILT=1 SHOTS_SCRIPT=gif.ts
SHOTS_COMPOSE_PROJECT=odudu-p4g-gif ODUDU_HOST_PORT=3187 POSTGRES_HOST_PORT=5487
apps/docs/scripts/console-shots/with-stack.sh`. The assumption that a pure-JavaScript
encoder reaches the size held: `gifenc` 1.0.3 (MIT, no dependencies), a devDependency of
`apps/docs`, with no ffmpeg. A GIF cannot follow the reader's theme, so it is dark and a
still that does follow it sits under it. `with-stack.sh --check` runs the flow first
(`gif.ts --check` records nothing), so CI's `console-shots` job keeps the flow true.
The present step of the capture no longer rewrites hidden form fields: a recording that
signs in after the shot would otherwise post an address the server did not issue.

**Decisions.**

- **Badges** are the verify workflow, the licence and the docs. The release and the image
  badges arrive with `.github/workflows/release.yml`, and a test fails until they do. The
  docs badge points at the address `apps/docs/site.config.ts` gives, which answers once
  Pages is deployed.
- **The dark lockup.** `brand/lockup.svg` is `currentColor`, so on a dark theme it is
  black on near black as an `<img>`. `brand/lockup-paper.svg` is the same drawing in the
  paper colour, a test derives it from the lockup, and the README picks it by
  `prefers-color-scheme`.
- **Ibibio.** The README says nothing about what the name means: the owner's ruling of
  2026-10-21 removes it from public pages and `apps/docs/tests` pins that, which the older
  README row of the plan did not know. `TRADEMARK.md` says nothing either.
- **Owner notice.** `OWNER_NOTICE_NAME` (`Wisdom Praise`, owner ruling 2026-10-21) is a
  constant in `apps/docs/nav.ts`; the README, `TRADEMARK.md`, `brand/NOTICE.md` and the docs
  footer carry its sentence, and `tests/lint/community-files.test.ts` holds them to it. The
  mark was approved by the owner on 2026-10-21, who directs its use. The symbol is TM; a
  test fails on the registered one anywhere in these files.
- **The contact** in `CODE_OF_CONDUCT.md` and `TRADEMARK.md` is the address `SECURITY.md`
  already gives, which is the owner's commit address.
- **The CLA** is named in `CONTRIBUTING.md` as accepted under ADR 0042 with its text not
  yet published; the link arrives with the agreement.

## Increments 6 and 10: the release workflow and the quickstart job

`.github/workflows/release.yml` publishes from a pushed `v*` tag, and
`quickstart/prove.sh` is the ten-minute proof the `quickstart` job in `verify.yml`
runs. No tag has been pushed and nothing was published, so every claim below about
GitHub's runners, GHCR and cosign is an assumption until `v0.1.0-rc.1` runs.

**Plan changes.** These override the plan's Increment 5 and Task 6.

- **One QEMU build, not a native-runner matrix.** A single `docker/build-push-action`
  job builds `linux/amd64,linux/arm64`, so the SBOM and provenance buildx attaches are
  on the one index that is signed. The plan's `imagetools create` merge of two
  by-digest pushes would drop them. `docker/metadata-action` is not used: a tested
  script (`tools/release`) computes the tags, so "a release candidate is never `latest`"
  is a unit test and not a workflow expression.
- **No standalone SBOM action.** The SBOM is buildx's own (`sbom: true`), written to
  `odudu-sbom.json` by `docker buildx imagetools inspect --format '{{ json .SBOM }}'`
  and attached to the release; the signature covers the index that holds it.
- **No `release-dry-run` job in `verify.yml`.** A multi-arch QEMU build on every pull
  request costs more than it proves. The dry run is the workflow's `workflow_dispatch`,
  which GitHub offers only once `release.yml` is on `main`.
- **The proof is a job in `verify.yml`**, behind `changes` and in `gate`, not a
  `quickstart.yml`, so a skipped job passes and the gate stays the one check to require.
  It tags the image the `image` action builds as `ghcr.io/wizzywit/odudu:0.0.0`, the
  name `quickstart/compose.yaml` gives it, so the file under test is the unedited one.
- **Not built here, and the owner's call:** the `quickstart-arm` job, the compose
  validity job on macOS and Windows runners, and the plan's port-in-use step. arm64 and
  Docker Desktop on a Mac and on Windows are confirmed by hand (`RELEASING.md`, Owner
  steps); CI proves linux/amd64 only.
- **The release caveat** ("Arrives with the first release.") now waits for a dated
  stable section in `CHANGELOG.md`, not for `release.yml` to exist: `latest/download`
  skips pre-releases, so the address answers only after a stable tag.

**Verified.**

- `verified: quickstart/prove.sh 3262` against an image built from this commit and tagged
  `ghcr.io/wizzywit/odudu:0.0.0` printed `PASS elapsed 14s`: bare `docker compose up -d`,
  healthy, the banner, a console sign-in as the generated administrator (with the forced
  password change), `/docs/` served, then a second stack with an email and a password
  holding a quote and `$(id)` signed in with that exact password.
- `verified: docker compose logs --help` on Compose v5.6.0 has no `--no-log-stream`
  (the plan used it); `--no-log-prefix` is what strips the container name.

**Assumptions the first rc settles.**

- `assumption:` QEMU builds the arm64 half within the job's 90 minutes.
- `assumption:` with `sbom: true` and `provenance: mode=max` on a multi-platform push the
  index carries both, and `imagetools inspect --format '{{ json .SBOM }}'` prints an
  object keyed `linux/amd64` and `linux/arm64`; the workflow fails the release if not.
- `assumption:` the keyless identity of this workflow on a tag is
  `https://github.com/<repo>/.github/workflows/release.yml@refs/tags/<tag>`; the same
  job verifies it, so a wrong regexp fails the release rather than shipping.
- `assumption:` a tag pushed from a pull request's head triggers the workflow, and
  `gate` is a check run on that head commit.
- `assumption:` `releases/latest/download/compose.yaml` skips pre-releases.
- The examples against the published digest (the plan's Task 6c) wait for the rc.

**The Playwright action retries, through `install.sh`.** On 2026-10-23 the `docs` job was cancelled twice on a
stalled apt fetch from the Azure mirror. The first fix failed on the runner for three reasons. The runner image names
its mirrors in `/etc/apt/apt-mirrors.txt`, not in the sources, so the sed changed nothing. `timeout` killed only the
wrapper, because apt runs as root and the runner user cannot signal it. The orphaned apt-get then held the dpkg lock
and the retries died at once. The script rewrites the mirror list, sets `DPkg::Lock::Timeout`, and between attempts
kills apt, dpkg and clears the locks. verified: a fake apt-get hung in an `ubuntu:24.04` container reproduces the lock
failure without that step (three attempts, exit 1) and installs on the second attempt with it.

**The site from its own workflow, and the weekly link check.** `pages.yml` builds and deploys the site (manual
dispatch, or called by the `site` job of `release.yml`, which needs `release` and skips a candidate), with the
package script alone; the address stays in `apps/docs/site.config.ts`. Action commits resolved with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`: configure-pages v6.0.0 `45bfe019`, upload-pages-artifact v5.0.0
`fc324d35`, deploy-pages v5.0.1 `368f8252`, lychee-action v2.9.0 `e7477775`, cache v5.0.5 `27d5ce7f` (all lightweight
tags, full SHAs in the workflows). The SBOM is not on the site: the release job has only `odudu-sbom.json`, a map of
both architectures' SBOMs published as a release asset, not an SPDX file, so `/sbom/odudu.spdx.json` is left out.
`links.yml` checks `https` links in the Markdown sources, not the built site, so the `--offline` question for the
`/odudu/` prefix (assumption 14) is not settled and not needed. `apps/docs/site.config.ts` stays the one place that
defines the address; README, CONTRIBUTING and the issue templates link to it and `tests/docs/site-address.test.ts`
lists them.

Not observable without a real run: that GitHub accepts the workflow and the `github-pages` environment, that Pages is
enabled (owner step 4), that the artifact deploys and `page_url` is the address in the config, that lychee resolves
the Markdown sources with these arguments and its cache, that the old address redirects after a domain swap, and that
`releases/latest/download/compose.yaml` skips a release candidate. `.lycheeignore` skips the site until it answers.

## Increment 31l: `prompt=create`, the sign-up button

Initiating User Registration via OpenID Connect 1.0 (Final, December 2022) read in full from
`https://openid.net/specs/openid-connect-prompt-create-1_0.html`; the clause table and the
reading notes are `docs/protocols/oidc-prompt-create.md`. Three readings decided the shape.

- **Combination.** §4's exact words: "Care must be taken if combining this value with other
  prompt values. Mutually exclusive conditions can arise so it is RECOMMENDED that `create` not
  be combined with any other values." A RECOMMENDED, not a MUST, so the server may refuse or
  resolve; it refuses (`invalid_request`, `prompt is not valid`), the answer `none` beside
  another value already gets, because resolving would mean the server choosing what
  `create select_account` meant.
- **A tenant without registration.** §4.1: a value "not declared in the
  `prompt_values_supported` metadata field" SHOULD be answered with "an HTTP 400 (Bad Request)
  status code and an error value of `invalid_request`", with an `error_description`
  "identifying the invalid parameter value" RECOMMENDED. The description is the static
  `prompt=create is not supported: registration is off`; the delivery is the one every refusal
  below the RFC 6749 §4.1.2.1 boundary gets, a 302 to the validated `redirect_uri`, since the
  client is known and the spec's 400 is the OAuth answer where it is not.
- **Discovery.** §4.2: an OP that supports `create` "MUST define this metadata element", and
  then "must also specify all other prompt values which it supports". So the member is always
  present with the four Core values, and `create` is added per tenant on `registration_allowed`
  (and `enabled`), the same way `registration_endpoint` follows `client_registration_policy`.
  The constants live in `packages/contracts/src/discovery.ts` and `parsePrompt` reads them, so
  the document and the parser cannot drift.

**The page is the existing one.** `/authorize` parks the request as a login would and answers
303 to `accountPagePath(tenant, 'registration', signInPath)`, the builder `loginWays` now
shares, so the `return_to` is byte for byte what the sign-in form's _Create an account_ link
carries. The sign-in cookie travels on the redirect, so the mailed verification link resumes
the request exactly as the link flow does. `restartAuthorizeLocation` rebuilds `create` as
`login`: the way back after registering is a sign-in that asks for credentials, so the new
account signs in rather than whichever session the browser already held. A browser holding a
live session is shown the registration page all the same, and no code is issued from it. A
`create` beside an `id_token_hint` or a `claims` `sub` is refused (`invalid_request`, static
`prompt=create cannot be sent with id_token_hint or a claims sub`): either names one existing
End-User the response must be for, which a new account cannot be, and the hint is not parked, so
`restartAuthorizeLocation` could give the registration page no way back (the reason the sign-in
form's own link carries none for a hinted request).

**Performance.** The `create` branch runs before the session resolution and the initial
challenge: one `startAuthentication` insert and the `continuation` read of the parked request,
which is fewer queries than the login page makes (no `resolveSessions`, `enabledSubjects`,
`initialChallenge`, client name). Discovery gains no query: `registration_allowed` is on the
tenant row it already reads. No new table, index or admin route; `pnpm test:plans` not needed.

**Security.** The redirect target is a path on this server built from the tenant name and the
rebuilt request, never from request input; the registration page validates `return_to` again
(`signInPath`) and `/authorize` validates the rebuilt request from scratch. Nothing of the
request is reflected in a page `/authorize` renders. The parked request is the request as sent.
The registration route's own limiter and 404 on a closed tenant are unchanged.

**OIDF.** The Basic, Config and Dynamic OP plans send `prompt=none` and `prompt=login` and read
the discovery document; none sends `create` or an undefined value, and `prompt_values_supported`
is OPTIONAL metadata the suite does not validate. No module's path changes.

**Transcripts re-run on the project `odudu-p4g-31l` (port 3331):** Path A §1 (the discovery
document gains `prompt_values_supported`), and a new section of Self-registration, _Starting at
the registration page_, with the open and the closed tenant.

## Increment 31c: front-channel frames before a matched redirect

A logout that named a matched `post_logout_redirect_uri` answered `302` at once, so a client
registered only for front-channel logout was never framed and kept its session. The frames list
was built only where `redirectTo` was null, and the other session-ending door, the confirmation
form's POST, had the same gate. Both now build it whenever a session ended.

**What it does.** With a matched redirect and at least one framed client the answer is `200`
with `renderLoggedOutRedirectPage`: one hidden iframe per client, a link to the target
(`state` added), a script that follows the link when every frame has loaded or after two
seconds, and a `meta refresh` at five seconds for a browser without script. With no framed
client it is the same `302` as before. `frame-src` and `script-src` come from the returned
`RenderedPage`, as ADR 0018's amendment asks.

**Findings.**

- `frontChannelLogoutUrl` accepted any scheme `URL` parses, so a row holding `javascript:` or
  `data:` would have reached an iframe `src`; the CSP refused it, but only because `new
URL(...).origin` is `null` there. It now returns null for anything but `http` and `https`.
- The `clientsForSession` read was unbounded: a session can hold a grant for every client of a
  tenant. A new `frontChannelClientsForSession(sessionId, limit)` returns only clients with a
  front-channel address, in client-id order, at most `MAX_FRONT_CHANNEL_FRAMES` (25). The rest
  are still told by back-channel logout. The back-channel path keeps `clientsForSession`.
- `frame-src` lists the origins of the framed addresses, not the addresses, because the
  policy's one builder (`pageHeaders`) takes origins; a path-level source is not available.
- The renderer lint (`instrument-reach.test.ts`) allowed `<iframe` in the logout renderer
  only; it now allows a meta refresh there too. The literal-text lint reads a standalone
  constant as text, so the script sits inline in the template, where only its quoted strings
  are checked.
- verified: Chromium (the Claude Code browser pane) on the built page and its headers: a
  refused frame redirects at once, a frame that never answers redirects, and with `script-src`
  removed the page still redirects after five seconds, so a `meta refresh` placed in `<main>`
  is honoured.

**Still on P4b.** The confirmation form's `client_id` and redirect fields are still not in the
anti-forgery token, and a leaked ID token still forces a `GET` logout. Neither falls out of this
change, so the roadmap keeps them on P4b and says so in one sentence.

## What P4g shipped and what it left

**Shipped, by what a person can do.** A stranger with Docker runs one command and gets
Postgres, Odudu, a system tenant and a first administrator with a one-time password; the image
is built, signed and listed by `release.yml` from a tag, with base images pinned by digest, and
a `quickstart` job proves the ten minutes. They read a documentation site (guides, concepts, a
console tour, operating and reference pages, `llms.txt`) and a landing page, and run four
example apps in CI and a hand-tested WordPress guide. Every server page and mail shares one
look, with text in catalogues. An app can send a person to the registration page with
`prompt=create`; registering with a taken address no longer says so when verification is on;
password rules follow NIST SP 800-63B-4; every cookie follows one TLS setting; the issuer is the
configured public base; built-in scopes can be deleted and restored; a reset ends all access.
The README, SECURITY, CONTRIBUTING, code of conduct, trademark policy and CLA are in place.

**Left in P4g after the first candidate: built since.** The Core Web Vitals and Lighthouse
budgets (31b), the landing additions and the `max_clients` console wording are done; see the
whole-phase review fixes at the end of this note.

**Owner steps** (`RELEASING.md`): the package is public, `gate` is required on `main`, a
`release tags` ruleset covers `v*` and the `github-pages` environment allows `v*` tags. Still
open: run the quick start by hand on a Mac, on Windows and on arm64, and test the CLA from a
second account before adding `cla` to the required checks.

**Rulings I made** (in the session ledger, which is not committed):

- No fourth security re-review of the 31k round that moved registration to a confirm step,
  because usage was short; the whole-branch review had to cover reset-ends-access, the
  `pg_advisory_xact_lock` creation paths and the limiter.
- Hold 31c, 31b and the landing additions until after the weekly reset, and ship the rc first,
  because every one of them is separate from the release machinery.
- Place the required-action password gap on P4f, and the append-only audit trail on P12, rather
  than fix them here: each is outside what P4g builds and each now names its phase.
- A reset-link one-use claim needed no new test: `reset-password.int.test.ts` ("refuses a reset
  link a second time") and `action-tokens.int.test.ts` ("refuses a second redemption") hold it.

**Owner rulings worth keeping beside them:** the landing names no phase and its chips read
"Planned"; built-in scopes are deletable with a typed name; password length stays 8 to 256 with
soft enforcement, mapped to `otp_required`; wording is plain and short; the README lists
shipped capabilities and links the roadmap, with no planned-feature list of its own.

**Transcripts to re-run later.** The `console-paths/get-console.md` shell block; the "Too many
attempts" and "Update your account" page kinds, never reached on a live stack; and the harness
estimate of 25 to 40 hours for a full re-run. None of them is a wrong claim today: each is a
capture older than the code it describes.

### Increment 31b, Core Web Vitals and Lighthouse budgets in CI

`apps/docs/lighthouserc.json` holds the budgets (`@lhci/cli` 0.15.1, the version the plan names; the registry's
release-age rule allowed it) and the `lighthouse` job in `verify.yml` runs it on the Pages build, served by
`scripts/serve.mjs` on 4291. Three runs per page, median, Lighthouse 12.6.1, mobile profile, simulated throttling. Two
differences from the plan text: `serve.mjs` takes `--base` and `--port` flags, not positionals; and the job builds
`build:pages` itself, because the `docs` job uploads only a test report, no `dist/pages`. The job needs `changes` and
runs when `buildImage` is true, like `console-shots`. A `pnpm.overrides` entry (`chromium-bidi>zod`) keeps the
lockfile at one zod, which `tests/lint/console-zod-instance.test.ts` requires; `@lhci/cli` pulled a second.

**Medians per URL**, on a loaded laptop (load average 15 to 40), second full run:

| URL (after `/odudu/`)                          | perf | a11y | BP  | SEO | LCP ms | CLS    | TBT ms |
| ---------------------------------------------- | ---- | ---- | --- | --- | ------ | ------ | ------ |
| `` (landing)                                   | 0.93 | 1.00 | 1.0 | 1.0 | 3,219  | 0      | 80     |
| `docs/quick-start/`                            | 0.95 | 1.00 | 1.0 | 1.0 | 2,889  | 0      | 67     |
| `docs/guides/sign-a-user-in/`                  | 0.89 | 1.00 | 1.0 | 1.0 | 3,409  | 0.0006 | 161    |
| `docs/reference/generated/admin-api/subjects/` | 0.93 | 1.00 | 1.0 | 1.0 | 2,949  | 0      | 121    |
| `docs/concepts/tokens/`                        | 0.91 | 1.00 | 1.0 | 1.0 | 3,350  | 0      | 71     |

- **Found and fixed in the page:** SEO was 0.92 on every docs page. The sidebar's non-collapsible "Start here"
  category rendered an `<a>` with no `href` (`crawlable-anchors`). It is now a heading item
  (`type: 'html'`), and `ia.test.ts` fails on any sidebar anchor without an `href`.
- **Not met: LCP at most 2,500 ms.** All five pages are 2.9 to 3.4 s under the simulated profile, as the Increment 31
  note predicted (3.3 s on the landing). `guides/sign-a-user-in` also misses performance 0.90 (0.89). The budget is
  unchanged. verified: with the two `<script defer>` tags removed from a copy of `docs/concepts/tokens/`, simulated LCP
  is 1.58 s (2.81 s with them; `async` instead of `defer` changes nothing). The shared Docusaurus bundle (177 KB gzip,
  322 ms of scripting) is the cost, not the page. Until that bundle shrinks, the `lighthouse` job fails.

**Throttling method changed to `devtools` (same 4x CPU, 1.6 Mbps, 150 ms RTT; every bound unchanged).** The 2,500 ms
LCP threshold is a field figure at the 75th percentile. Lighthouse's simulated profile is deliberately harsher, and
no real reduction here reaches it: the shared bundle is React (36 %), Prism (18 %) and route data (20 %), and removing
Prism cut 26 KB gzip with no gain beyond noise. Simulated medians stay the stricter reference and the baseline for a
later bundle diet (build-time Prism highlighting, route data): LCP 2,889 to 3,409 ms, and 3,069 / 2,925 / 2,865 /
3,591 / 2,867 ms on the CI runner. Under `devtools`, locally, medians: landing LCP 1,946 ms, quick-start 1,629,
sign-a-user-in 1,643, concepts/tokens 1,626, admin-api/subjects 1,711; performance 0.95 to 0.98, CLS 0 to 0.0006,
accessibility, best practices and SEO 1.00. TBT is 124 to 129 ms, and 234 ms (259, 234, 233) on
`admin-api/subjects`, over its 200 ms bound.

**Main-thread work cut from the CI numbers (TBT 213 / 245 / 270 / 479 / 259 ms against 200).** Long-task attribution
showed the shared script's evaluation (200 to 275 ms), the hydration task (50 to 140 ms) and, on the subjects page, a
172 KB document to lay out (174 ms). Three changes:

- **Code highlighting moved to the build.** `prism-react-renderer` is a tokenizer with its grammars, loaded on every
  page and run again on every code block at hydration (the theme also remounts each block after hydration). A remark
  step (`plugins/code-tokens.ts`) now tokenizes the fenced blocks that have a grammar (json and sql; bash and sh have
  none in that library, so they were never coloured), and the page carries the lines. The browser loads a 30-line
  stand-in for the library (`src/features/code-block`), colours are `.tok-*` classes written from the two Prism themes
  into `src/css/code-tokens.css` (held to the themes by `tests/code-tokens.test.ts`), and the block no longer
  remounts. Shared script 177 KB to 152 KB gzip; the style-attribute hashes in the CSP fell from 9 to 2.
  Measured on `concepts/tokens/` with the library stubbed: TBT median 170 to 89 ms.
- **The subjects reference is four pages.** `subjects` (the subject and its profile), `subject-sign-in`,
  `subject-access` and `subject-sessions`, by what a reader is doing; every operation keeps its own anchor, and the
  console pages now link the area they mean. The coverage ratchet rows were split with the numbers each page has.
- Landing first-load JavaScript is 175.8 KB gzip; the Playwright bound is 180 KB (was 200).

Local lhci medians of TBT, same loaded machine, before and after: landing 144 to 70, quick-start 155 to 81,
sign-a-user-in 224 to 76, admin-api/subjects 319 to 115, concepts/tokens 157 to 80. On a quieter machine the final
run is 53 / 52 / 56 / 59 / 55 ms with performance 0.97 to 0.99 and every budget met. Left: react-dom (36 % of the
shared script) and the route data (20 %); neither is a budget problem at these numbers.

**Old anchors on the subjects reference.** The operations that moved to `subject-sign-in`, `subject-access` and
`subject-sessions` no longer have their anchors on `subjects/`. GitHub Pages cannot redirect and nothing links them
yet; a reader of an old link lands on the top of `subjects/`.

**The TBT bound is 350 ms, because the CI runner's speed varies by about 1.8 times.** The same build, measured on the
runner on two runs, had a CPU benchmark index of about 3,700 (TBT 65 to 157 ms, green) and about 2,060 (TBT 143 to 300 ms,
red against 200). A 4x slowdown applied to a slower host is a harsher profile, so a bound inside that spread fails on
runner luck and not on a regression. LCP (at most 2,500 ms, measured 1.6 to 2.1 s on both) and the other bounds do not move.
350 ms sits above the slowest measured page (300 ms, the subjects reference) and well under 600 ms, where Lighthouse scores
TBT as poor; a real regression in script cost still crosses it.

## Landing additions

A strip of the server pages, a "Built for AI agents" band, a "Branding and theming" item and a WordPress line.

- **The four pages are the real renderers' markup.** `pnpm page-shots` (`apps/docs/scripts/page-shots/run.ts`) calls
  `renderLoginForm`, `renderRegistrationForm` and `renderResetRequestForm`, serves the result with the built
  `packages/instrument/dist` stylesheet and fonts, and photographs the card in Chromium, light and dark, into
  `static/server-pages/` as WebP (about 8 KB each) with a `manifest.json` of sizes. The second-factor page is
  `renderLoginForm` with the `otp` step. Nothing is drawn by hand.
- **The branded picture is the same markup with colour tokens swapped.** `scripts/page-shots/brand.ts` injects one
  `<style>:root{...}</style>` that replaces ten colour tokens of `tokens.css`; a test holds each one to a token the
  stylesheet declares. The wordmark and layout are untouched, so only colours differ, which is all the picture claims.
- **The swap needs no script.** Two radio buttons and `:has()` choose which of four lazy images shows (look by theme);
  the fieldset legend says it is an illustration of a planned feature. First-load JavaScript did not change.
- **Planned claims are tied to the roadmap by `apps/docs/tests/landing-planned.test.ts`.** Each item in `content.ts`
  carries `quotes`, phrases it repeats word for word; the test fails if the roadmap's Next or Later lines stop saying
  one, or the built landing page does. Chips read "Planned" and each item links `roadmap/#next`; no phase, date or
  "soon" appears in the sections, which a test also checks.
- **One roadmap sentence was added** to the theming bullet ("A tenant sets its own logo, colours, wording and default
  language, and its mail follows the same theme"), because the page named none of the items the theming item lists.
  Section 11's P4b row already has each of them; `tests/docs/roadmap-section-11.test.ts` maps the sentence.
- **The MCP claim is the roadmap's, not "a scoped short-lived token".** The roadmap says the admin API as tools for an
  agent, read-only by default, and a guide to protecting an MCP server with Odudu; the landing repeats those two
  sentences. A second planned item, agent identity, quotes the P5 line.
- **The old assistants pane left the documentation band** (it named a phase). The landing has ten bands now, and the
  cap in `landing.test.ts` moved from eight to ten.
- Lighthouse (local, mobile throttling, landing, three runs): performance 97, 97, 98; LCP 1,960, 1,951 and 1,929 ms;
  CLS 0; TBT 23 to 26 ms. All budgets pass; the other four pages too.
- **Fix round after review.** A browser test (`tests/branding.browser.test.ts`) holds the swap: one picture visible by
  default in each theme, the keyboard on the radio switches to the branded one and back, and the picture loads at its
  size. The band heading says what is planned; the "ships today" line says no page is translated yet and is checked
  against the roadmap's "Translated pages and mail".

## Landing design pass

The pages band, the branding item and the agents band were redone after an owner review at 1440 px.

- **The strip is two rows.** Sign in and Create an account are large, side by side; Reset a password and Second factor
  are small, each with a sentence beside it. Every screenshot sits in a `Frame` of one fixed aspect ratio per row
  (large 460:690, small 460:480): a taller page is cropped at the bottom, a shorter one is centred on the page
  background, so a row never changes height. The images keep their intrinsic `width` and `height`.
- **The pictures are taken at twice the size** (`deviceScaleFactor` 2, still 8 to 24 KB each) so the large pair stays
  sharp at 540 px. The manifest keeps CSS pixel sizes and now holds a hash per page.
- **Drift guard.** `scripts/page-shots/shots.ts` holds the pages and `renderedHash` (markup in both themes with the
  random script nonce removed, plus `tokens.css`, `fonts.css` and `pages.css`). `drift.test.ts` fails, naming
  `pnpm page-shots`, when a hash differs from the manifest. CLAUDE.md's documentation list names it.
- **Branding is its own band.** `Section` takes an `aside`: text, the Planned chip, the "ships today" line, the legend
  and the swap on the left; one framed picture on the right. The swap still needs no script (`:has()` on the band);
  the picture loads at 920 px wide now.
- **The agents band holds only the two Planned items**, as two wide cards. The Markdown line moved to the
  documentation band: "Every page also comes as Markdown, and llms.txt lists them."
- **Browser test** `tests/landing-layout.browser.test.ts`: at 1440, 1024 and 400 px, in both themes, no horizontal
  scroll and frames of one height and width per row; and each of the three bands' content spans the container.
- Band heights at 1440 (before, after): pages with branding 1,543 to pages 1,447 plus branding 729; agents 437 to 430. Branding plus agents together are 1,159. Lighthouse (local, three runs, landing): performance 0.97, LCP 1,991 ms
  median, TBT 37 ms median, CLS 0.

**Fix round.** The large pair is cut to one 460:724 canvas and the small pair to one 460:449 canvas, centred on the
page's own grid, so no page floats in blank colour or is cropped (the sign-in capture now offers a passkey, which is
what the server shows when it can; the second-factor capture drops "Remember me"). The branding pictures are their own
captures (`look-odudu`, `look-other`). The strip is three columns at 900 px and up: the large pair, then the small pair
stacked. Band padding at 997 px and up is 4rem, not 5rem. The layout test now measures leaf content, and was shown
to fail with a left-aligned branding picture and with narrowed agent cards. Page length at 1440: 7,760 before, 7,609
now.

## Fixes from the whole-phase review (docs and release)

Each finding was checked against the repository before it was changed.

- **Placement text.** The roadmap no longer says the image is unpublished; its P5a, P4f and P4b
  bullets are short, with the detail left in section 11 and `docs/NEXT.md`. NEXT.md's position, the
  P4g row and ordering line (now ending P4i) and the changelog's `[Unreleased]` match main. rc.2's
  changelog date follows its tag (24 October).
- **Security wording.** SECURITY.md, `security/disclosure.md` and `security/index.md` cite what the
  README says (a release candidate, no independent security review) and scope out a deployment
  that switches off a boot guard.
- **Windows.** The README and the quick start give `curl.exe ...; docker compose up -d` beside the
  bash line; tests hold both.
- **Client cap and subjects wording.** `max_clients` says it holds however a client is made; the
  subjects page says people and services; `pnpm docs:screenshots` recaptured the records.
- **Release machinery.** `release.yml` refuses a stable tag that is not on `main`
  (`git merge-base --is-ancestor`), and `latest`, `X.Y` and the GitHub Release's latest mark move
  only to the newest release (`tools/release`, tested). Every action is pinned
  (`tests/lint/actions-pinned.test.ts`), Dependabot has a two-day cooldown beyond pnpm's
  `minimumReleaseAge`, and `packageManager` carries the integrity hash `corepack use` computes.
- **cosign.** verified: `gh api repos/sigstore/cosign-installer/contents/action.yml?ref=<pinned sha>`
  shows the signing step installs cosign v3.0.6. cosign is not installed here, so "3.0 or newer"
  is inferred from that and stated as a plain minimum.
- **Owner settings read from the live repository** with `gh api`: the `github-pages` environment's
  deployment policies (`main` branch, `v*` tag), the `release tags` ruleset (creation, deletion and
  non-fast-forward on `refs/tags/v*`) and the branch protection contexts (now with `gate`).

## Fixes from the whole-phase review (console and admin API)

- **Load more.** `useListPages` stops appending at `ROW_BUDGET` (1,000 rows) and exposes `loadLimited`;
  `LoadMore` and the pager then say "This is as far as the list can load. Narrow it to see further."
  in place of the button. Next still pages on, since it replaces the rows.
- **Service subjects.** `deletionRefusal` (subjects service) replaces the Delete panel's button for a
  `service` subject. The subject carries no client id, so the sentence names no client.
- **`If-Match: *`.** `requiredPrecondition` and the client list-field check read `*`, alone or in a
  list, as no precondition (428). `matches` takes a comma-separated list and any member; `*` still
  matches on routes where the precondition is optional. Integration tests that used `*` as a stand-in
  now read the ETag (`etagAt` in the admin fixture); the lock tests hold a real tag, so the second
  writer is refused with 412 where it used to overwrite. verified:
  `vitest run --project integration packages/protocol-admin/tests`, 82 files green.
- **Error ID.** The tour page says the ID is made in the browser and is not in the server's logs.
  Sending it to the server is a P4h row in `docs/NEXT.md`, on the roadmap and in section 11.
- **Restore dialog.** `RESTORE_DIALOG_TITLE` and `RESTORE_CONFIRM_LABEL` live in `service/restore.ts`;
  the `settled` flag is `held` in `useRestoreScopes` and `ConfirmDialog`.

## Transcripts replayed on the final image: `reference/transcripts/console-paths` and `first-start.md`

Same request as the `request-paths` entry (owner, 2026-10-21). This is the record for the 22 pages
of `console-paths` and for `first-start.md`.

- **Image.** Built from `main` at `5eeac524` with `ODUDU_REVISION=5eeac524` (`docker compose up
-d --build`, image `e5edfb2ab9a8`); `first-start.md` ran on an image built from the same commit
  with `docker build` (`6f726d626236`).
- **Stacks.** `odudu-p4g-rerun-console-a` on 3701 (Postgres 5701) for every console page, on one
  fresh volume, with `ODUDU_THROTTLE_LIMIT=1000 ODUDU_LOGIN_THROTTLE_LIMIT=1000`. Once, after
  the others, its server was recreated with `ODUDU_TLS=true` and
  `ODUDU_PUBLIC_BASE_URL=https://localhost:3701` (the server refuses `ODUDU_TLS=true` with an http
  base) and `odudu console provision` run for the new base; only the new "Behind TLS" section ran
  there. `odudu-p4g-rerun-console-qs1` and `-qs2` on 3702 (`quickstart/compose.yaml`, one fresh
  volume each) and a `postgres:17-alpine` container on 5702 for `odudu init`. Every stack was
  removed with `down -v`, the image and the container with `rmi` and `rm`.
- **Method.** Shell helpers outside the repository ran each command of a page in order with a
  curl jar per browser, took the ids the page takes from the run before it (`$LOCATION`, `$CB`, the
  subject ids), rewrote only the port, and compared each response with the next block after
  masking ids, timestamps, tokens, `Date`, ports and the stack's `ip`; `content-length` was not
  masked. The three second-run chains were kept as the pages have them: `grace` on `console-paths`
  through the callback, the second tab and the writes; `ada` on `system` through the loopback
  sign-in, the gateway's assertion pages, the refresh pages and the logout. The refresh pages were
  waited for in real time: the token lives 300 s, so the three of them took about 20 minutes.
- **Re-derived (a real difference):** the login cookie lasts 1800 s (the page's 600 s first run and
  its 1800 s second run are now one block); the tenant's authenticate `302` clears `odudu-sign-in`
  (four blocks); the callback `302` also clears `odudu-console-restart`; the sign-in form's `GET`
  sets `odudu-sign-in` and is longer (3581 bytes with the passkey form, so the block is cut at the
  password form and says so with `…`); the discovery document lists `ui_locales_supported` and
  `prompt_values_supported` (2412 bytes for `system`, 2508 for the second tenant); the console
  shell names the favicon and apple-touch icon, and a hashed asset carries
  `x-content-type-options: nosniff` (the shell is 1340 bytes, the entry 326713 and the Subjects
  chunk 392705 on this build, still the largest chunk). First-start: the `--add-admin` banner ends
  with the blank line the other banner has.
- **Identical (ids, times and the `ip` aside):** the restart and the refusal pages (888 bytes), the
  access-denied callback, the session and subjects reads, the `PATCH` with its `412`, the audit
  row, the cross-site and principal refusals (the principal page's audit read, run here over a
  millisecond window because the cross-site section's write fell in the same second), the
  escaping paths and the request log that shows
  which route took them, the gateway's refusals without an assertion, the refresh with one, the
  once-only assertion (`200 401`), the refresh, the lock section (`502` after 5.0 s, the refresh
  after the commit), the server-refused refresh (the `400` from the token endpoint, the row gone),
  the logout and its redirect, and the three first-start compose and `init` transcripts.
- **Ids made consistent:** the blocks of the console-paths first run (login to the next page),
  the refused and restarted callbacks, the `ada` chain (gateway, refreshes, logout) and the
  restarted callback were replaced by this run's, so each chain reads as one run. The `PATCH`,
  cross-site and principal pages (one run of their own) and the unchanged blocks of the others
  keep their earlier ids.
- **Prose changed to say what the run did:** the refresh section waited until the token was under
  30 s from expiry (6 s here, not 18); the lock section runs on a session whose last refresh was
  4.5 minutes before, without the refresh before it being shown.
- **Removed:** two `docker compose down -v` blocks for stacks of other runs (the discovery and
  Console shell pages), commands nobody can run against these pages.
- **New, run for real:** "Behind TLS" in `GET /console/auth/callback`: `__Host-odudu-console-login`,
  `__Host-odudu-console-restart` and `__Host-odudu-console`, each with `Secure`, the tenant's own
  `__Secure-odudu-sign-in` and `__Host-<tenant>-session`, and a write refused for an `http`
  `Origin` once the base is `https`. curl does not send a `Secure` cookie over http, so the cookies
  were sent by hand. A browser over real TLS stays an integration test and the `conformance` job.
- **Run for a block's sake:** the boot warnings in `contributing/transcripts.md` (the first two
  lines reproduce, ids and times aside; the third was about a missing console build the image has
  carried for a long time).
- **Observation, not changed:** `GET /console/auth/callback`'s first run returned to `/console/` in
  the original record and to `/console/x` here, because the `return_to` of the sign-in used was
  `/console/x`; the page's sign-in command was not shown for the `ada` chain.

## Transcripts replayed on the final image: `reference/transcripts/request-paths`

The owner asked (2026-10-21) for every transcript the phase touched to be run again against the
final image and diffed against the committed blocks. This is the record for the 26 pages of
`request-paths`; the other two directories have their own entries.

- **Image.** Built from `main` at `758fdb6e` with `ODUDU_REVISION=758fdb6e`
  (`docker compose up -d --build`, image `86d45fc52ec6`).
- **Stacks**, each on a fresh volume: `odudu-p4g-rerun-request-paths` on port 3611 (Bootstrap through
  Path D, the CORS, branches, docs and mail pages, with the server recreated for the pages that
  name a variable: `ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false`,
  `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`, `ODUDU_TRUST_PROXY=true`, `ODUDU_DOCS_DIR`, `ODUDU_DOCS`, an
  SMTP relay to Mailpit 1.31.5); `odudu-p4g-rerun-ret` on 3612 for Retention alone, driven only as
  far as that page says; `odudu-p4g-rerun-lo` on 3613 for RP-initiated logout, Brute-force lockout
  and Path D, with `ODUDU_REAP_ENABLED=false`, `ODUDU_LOGOUT_SENDER_ENABLED=false` and
  `ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true`, and the default throttle budgets where the page needs them.
- **Method.** A driver outside the repository ran each fenced command in the page's order in one
  shell with its variables kept, rewrote only the port, supplied the values the page took from an
  earlier stack (a parked session, a mailed key, an admin token from `odudu console assertion`) and
  compared the output with the next block. Ports, ids, timestamps, nonces, tokens, request ids,
  `Date` and the elisions the pages already make were masked; `content-length` was not. The
  pages that run a command as prose or in an untagged fence were replayed by hand.
- **Changed, from the run:** a login `302` and a consent `302` now clear `odudu-sign-in` (11 blocks in
  Path A, TOTP, Recovery codes, Password reset, Password expiry, RP-initiated logout, Brute-force lockout); the
  authorization form's GET carries `set-cookie: odudu-sign-in` (Path A); the refused-login page grew to
  3654 bytes (Path A) and the spent-link page offers a way to request a new link (Required-actions
  link); the logout confirmation form carries `csrf` (RP-initiated logout); the browser-visible 500 is
  `application/problem+json` with no cause (Bootstrap); two recorded `content-length` values were from
  before the shell (signed-out page 318 to 974, recovery codes 2041 to 2107); the CORS discovery
  `content-length` is 2490; the 429 page is 895 bytes and the refused sign-in form 3655 and 3656
  (Brute-force lockout); `docs` build values (CSP hashes, `etag`, length) are this build's.
- **Commands that could not have produced their block as written, corrected:** the-branches' reuse
  `CODE=$(curl …)` sent no `-D`, so `CODE` was empty; its `ADA_SESSION` `grep` matched the chooser's
  markup from before the buttons carried classes; the two `/revoke` calls in RP-initiated logout printed
  nothing without `-i`; the offline-logout confirmation was posted without `csrf`, which is a `400`; a
  `grep` in Password reset printed `</a>` that the pattern never matches.
- **Queries scoped so another stack gives the same answer:** the recovery-code count by tenant.
  Blocks that showed only part of a response now say so ("elided here", "omitted").
- **Stale or wrong:** a literal `…` in two plain blocks (now `…`); the cap-demo cookies, the reset
  login's cookie and the `auth_time` pair in the-branches, re-run (the pair is 38 seconds apart).
- **Identical:** Bootstrap's seeds and registrations, Path A's discovery, JWKS, authorize, token and
  userinfo blocks (the encrypted `/userinfo` re-run with generated RSA keys: 1451 and 513 bytes),
  Path A as a confidential client (the Mailpit anchors included), Self-registration (every block),
  Path B, Path C (and `seed client --client-credentials-scope`), Path D, Retention (every count, on
  its own stack), Sending queued mail, One sign-in's audit trail (the `ip` is the stack's), the
  mail captures' `htmlBytes` (5839, 5922, 6039 and the reset's).
- **No commands, not run:** the index, The shape of it, What to do next, Enrolling a passkey and Signing
  in with a passkey (the second's form excerpt was re-derived from the sign-in page).
- **Run afterwards:** Bootstrap's host mode (Postgres in a container of its own, port 5614, the server
  from the source with `node --env-file` on 3618) and its no-Docker mode (a throwaway cluster from
  `initdb`, PostgreSQL 18.6, port 5616, the server from the source on 3616) both seed, register and
  issue tokens as the page shows, and the key-mismatch 500 was reproduced as a host run. The
  `/token`, login POST and `/userinfo` tables in the-branches were run row by row (the `/authorize`
  tables, the `code_challenge` and empty or repeated parameter rows and the `id_token_hint` rows
  earlier). Two rows were wrong: a public client asking for `client_credentials` is `400`
  `unauthorized_client` ("This client may not use this grant type."), not `401` `invalid_client`
  (`audit-token-refusals.int.test.ts` holds it); both rows now say so. The rest agree.
- **State prepared, said here because a page does not say it:** unsent `email_outbox` rows deleted
  before Sending queued mail (this stack held rows from the required-actions section);
  `login_failures` emptied before the first brute-force run, as that page says.
- **Observations, not changed:** `odudu seed grant-role` and `map-role` fail with a raw unique-key error
  when repeated; `seed --send-verification-email` warns that `--issuer-base` was not given and mails
  `http://localhost:3000`, the container's own port; Node prints a `DeprecationWarning` for a TLS server
  name that is an IP address on the back-channel send (stderr, left out, and the page says so).

## Transcripts replayed on the final image: `reference/transcripts/admin-paths`

The 73 pages of `admin-paths` (70 with commands; the index, What to do next and `DELETE
/subjects/:id` have none), run again and diffed against the committed blocks.

- **Image and stack.** Built from `main` at `9b81712c` with `ODUDU_REVISION=9b81712c` (image
  `bf06b3731f5d`). One stack, compose project `odudu-p4g-rerun-admin-a`, ports 3650 and 5650, run in
  index order on one volume, so a tenant's state is what the pages above it left. Started with
  `ODUDU_THROTTLE_LIMIT=1000` and `ODUDU_LOGIN_THROTTLE_LIMIT=1000`; the server was recreated once with
  `ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true`, `ODUDU_LOGOUT_SENDER_ENABLED=false`,
  `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true` and `ODUDU_OUTBOX_ENABLED=false` for the pages that name them.
  Mailpit 1.31.5 served the one page that shows a delivered mail.
- **Method.** A driver outside the repository ran each fenced command in the page's order in one shell
  with its variables kept, replaced only the port and the compose project, and compared the output with
  the block that follows. Ids, `Date`, nonces, tokens, request ids, etags, cursors, container
  addresses, log `time`, `pid` and `hostname` were masked; `content-length` was not. A command that
  used an id an earlier block printed got the new id by position. Where a block differed it was
  written again from the run, keeping the page's own ids on every line that did not change.
- **Changed, from the run:** a login `302` clears `odudu-sign-in` (Getting the token, the consent `302`);
  the client record carries `service_account_admin_reach` (every client block, `content-length` +33);
  a role listing carries `admin_reach` (a group's roles) and a capability-filtered subject listing
  carries `admin_capabilities`; `whoami` answers `capabilities` and `crossTenant` to a token holding none;
  a `401` carries `cache-control: no-store`; `DELETE /clients/:id/grants` and `DELETE /lockouts` answer
  `remaining` (the notes saying they did not are gone); the tenant rename refusal names ADR 0039; the
  change-password `POST` completes the sign-in (`302` with a code) where it once returned the sign-in
  page (Password issue); a subject with no TOTP is not owed recovery codes, so the sign-in after `PUT
required-actions` does not stop on a page (Recovery codes); `odudu console assertion` writes a
  `console.assertion` row (Password issue); the tenant has a 37th table, `pending_registrations`
  (Delete a tenant); the published OpenAPI schemas carry descriptions; the mail log's Node frame is line 2083 and the SMTP error names `originalCode`;
  `seed --user` without `--password` is refused, so the lockout page's seed command now passes one.
- **Commands that could not have produced their block as written, corrected or completed:** the
  tenant-create page had a response listing tagged as a command and no refusal commands; Amend tenant,
  Amend client, Required actions, Composites, Flow, SMTP, Keys (the whole rotation), Consent and
  Sessions showed one command for several outputs or none for a block; Delete client showed one `DELETE`
  for three answers; Scopes had a four-backtick fence that swallowed the `DELETE` section (now three,
  and the section is prose again) and a `psql` with no host; Required actions and Sessions used a
  session id typed by hand; `$A/../tenant-imports` resolved to a path the router does not have; the
  `$NEW_SECRET` the rotation used was never set; a session id, an `If-Match` after an out-of-band write
  and a cursor were read from the previous command by hand.
- **Hand-cut output, now the real output:** many blocks printed only some headers or lines, with a
  sentence saying so. Where the cut was the point, the command now does it (`grep -E
'^(HTTP/|etag:|\{)'`); elsewhere the whole response is shown.
- **State prepared, because a page does not say it:** `odudu-admin` of `system` set back to the loopback
  redirect list with `UPDATE` (the "seeded before the console existed" state); `demo`'s `grace` deleted
  before Scopes seeds her with a password; unsent deliveries of other tenants deleted before Delete a
  tenant (its `send-logouts` pass sends every tenant's); 12,000,000 `audit_events` rows inserted as the
  database owner for the audit bound, then deleted and the table vacuumed; 20,001 clients inserted for
  the export bound; `demo`'s flow put back after Flow; the built-in scopes page runs in its own tenant,
  `builtins-demo`, because `demo` now has many more clients than that page counts.
- **Prose that described a state the stack no longer has, rewritten:** the subject counts in the list and
  count pages (they now describe `demo` as it stands), Sessions (no `bob`), Password issue (which rows
  the trail holds), the clients page (no note that the records predate a field).
- **Timing.** The audit bound page's second block is not stable: the unwindowed request is refused at
  about 5.0 s every time, but the count and the export sit at the bound. On the first pass over fresh
  rows each was refused; on the pass recorded they finished in 4.5 s and 3.3 s, and warm (1.3 s) they are
  well inside it. The page says which happened.
- **Identical:** `GET /admin/tenants`, `GET /whoami`, `GET`/`PATCH /settings`, evaluate, installation,
  logout deliveries, `DELETE /sessions`, the subject sessions and lockout pages, grants, credentials,
  bulk, password reset and verification, the group roles and default pages, the audit export, the
  username policy and `DELETE /keys/:id`.
- **No commands, not run:** the index, What to do next and `DELETE /subjects/:id`.

## Closing the phase

What the phase measured, what its whole-phase review found, and what the close decided. The
closing pass is on 2026-10-27; the phase ran from the design on 2026-10-15 to the last transcript
replay on 2026-10-27.

### Each increment, measured

Commits and files changed come from the ranges the ledger recorded for each increment (`git rev-list
--count --no-merges` and `git diff --shortstat` over the range). The ledger holds no range for
increments 5, 6, 10, 16, 19, 31j to 31r, 34 and 35, which landed in the same pull request, so they
have no row; the whole pull request (#64) was 375 commits.

| Increment  | What it delivered                                                  | Commits | Files changed |
| ---------- | ------------------------------------------------------------------ | ------- | ------------- |
| 1 and 2    | Spikes: the site, the stack and the pages                          | 2       | 1             |
| 3          | Roadmap row, licence, LICENSING                                    | 2       | 29            |
| 4          | Pinned bases, the `odudu` command, Dependabot                      | 4       | 16            |
| 7          | CLI help registry                                                  | 2       | 13            |
| 8          | `odudu init`                                                       | 4       | 13            |
| 9          | The prompt, the compose file, the `setup` service                  | 4       | 16            |
| 11         | Instrument stylesheet, the CSP amendment                           | 5       | 35            |
| 12         | The shared page shell and the reach check                          | 4       | 40            |
| 13         | Catalogue runtime, negotiation, discovery                          | 4       | 101           |
| 14         | protocol-oidc pages in a catalogue                                 | 13      | 32            |
| 15         | authn-flows pages in a catalogue                                   | 8       | 43            |
| 17a, 17b   | Mail catalogues, bidi refusal                                      | 8       | 80            |
| 17c        | The server-literal lint                                            | 2       | 23            |
| 18         | The documentation app                                              | 7       | 70            |
| 20         | The documentation inside the image                                 | 14      | 42            |
| 21         | The docs command runner                                            | 1       | 13            |
| 22         | The path documents move into the site                              | 3       | 154           |
| 22b        | The documentation as a story                                       | 2       | 183           |
| 23         | Roadmap page, citations, retirement                                | 5       | 156           |
| 24         | Introduction, quick start, guides                                  | 4       | 35            |
| 24b        | The quick start through the console                                | 5       | 75            |
| 25         | The seven concepts                                                 | 2       | 45            |
| 26 and 26b | Console tour, `console-shots` job, roadmap for adopters            | 4       | 149           |
| 27         | Operating, security, contributing                                  | 4       | 28            |
| 28         | Examples: web app, API, machine to machine                         | 6       | 47            |
| 29         | Example: single-page app; logout resolves the client from the hint | 3       | 30            |
| 30 and 30c | The mark, wired across console, docs and server pages              | 6       | 183           |
| 30b        | Kickoff step, owner list, roadmap and section 11 test              | 5       | 14            |
| 31 to 31f  | Landing page and the Core Web Vitals round                         | 9       | 247           |
| 31d        | Documentation under `/docs/`, landing at the root                  | 2       | 67            |
| 31e        | Standard 404 and 500 pages                                         | 3       | 62            |
| 31h        | Console failure screens                                            | 3       | 72            |
| 31i        | A smoother sign-in scene                                           | 6       | 37            |
| 31g        | Links between pages and refusals in place                          | 15      | 124           |
| 32 and 33  | README front door, community files                                 | 5       | 76            |

After the first candidate each piece went in its own pull request, counted the same way:

| Pull request     | What it delivered                                                         | Commits     | Files changed |
| ---------------- | ------------------------------------------------------------------------- | ----------- | ------------- |
| #110 (31c)       | Front-channel logout frames before a matched redirect                     | 3           | 22            |
| #111 (31b)       | Core Web Vitals and Lighthouse budgets in CI                              | 10          | 38            |
| #112, #114       | Landing additions, then the redone pages strip, branding and agents bands | 3 and 2     | 54 and 49     |
| #113             | Whole-phase review: server findings                                       | 7           | 44            |
| #115             | Whole-phase review: documentation and release findings                    | 16          | 63            |
| #123             | Whole-phase review: console and admin API findings                        | 5           | 79            |
| #124, #126, #127 | Transcripts replayed on the final image                                   | 7, 4 and 44 | 17, 20 and 51 |
| #125             | Seed: mail the configured base URL, name repeats                          | 3           | 6             |

Tests that pin the work are in each increment's section above. Increments 14, 15, 16, 21 and 22b
were reviewed once, and their fix round was accepted without a second review.

### The whole-phase review

Four reviewers read `main` at `4160e26a` with `v0.1.0-rc.3` tagged, each from one angle: server and
security code, the console and admin API, the documentation and community files, and release and
supply chain. They found 48 points: no critical, 18 important (6 server, 8 documentation, 4
release) and 30 minor (6 server, 6 console, 12 documentation, 6 release). Every finding was checked
against the repository before it changed anything.

- **Fixed or done:** 16 of the 18 important findings, in #113, #115 and #123, and by the owner's own
  settings: a stable tag must be on `main`, `latest` moves only to the newest release, every action is
  pinned, a reset or an actions link ends sessions and grants and clears factors an earlier holder
  enrolled on an address nobody verified, a reset matches an address case-insensitively, and a 500
  logs its stack. The console's minors that were bugs were fixed in #123 as well.
- **Placed:** a visitor can spend an address's mail budget, and a confirm click can create an account
  its sender chose (ADR 0037's amendment; P11 and P4f); case-variant accounts and their unique index
  (P4f); the failure screen's error ID and the console's literals (P4h).
- **Left, by decision:** the README's vision wording, tagline included (the owner's ruling: the README
  reads as the full Odudu, has no planned-feature block, and says in its status that some of it is
  still being built; this is the one important finding not acted on), and the Lighthouse flake (the budget was set above the runner's
  spread, and a re-run is the remedy).

### What the phase added to CI

On the last full run on `main` (run 40433485640, 2026-10-27), 33 jobs took 133 runner minutes and the
run took 14 minutes of wall clock. The CI restructure cut the `verify` run from about 27 minutes to
about 10 on its first full run, and the later jobs brought it back up. The jobs
this phase added to `verify.yml`: `docs` 6 minutes, `lighthouse` 8, `console-shots` 5, `quickstart`
3 and `examples` 3 each for three of its four legs, about 31 runner minutes together. `e2e` runs in
three shards of 12 to 13 minutes. `changes` skips the image-building jobs for a prose-only change
(ADR 0044), and `gate` waits for every job. Separate workflows: `release.yml`, `pages.yml`,
`docs-commands.yml`, `links.yml` and `cla.yml`.

### The owner's replies at the gates

- 2026-10-19: Docusaurus in place of Rspress, for adoption over a Vue-like look.
- 2026-10-21: the landing page at the root and the docs under `/docs/`; standard 404 pages, not
  themed; front-channel logout is protocol and belongs to this phase.
- 2026-10-22: console error screens, a smoother landing scene, the console favicon matching the docs,
  a neutral answer for a taken email address when verification is on.
- 2026-10-23: the README as the full vision with a true-today safeguard in its status section, and no
  planned-feature block; the merge of #64 and the tag `v0.1.0-rc.1` made on the owner's behalf.
- 2026-10-24: standing permission to cut the next release candidate once `main` is clean; the stable
  `v0.1.0` stays the owner's.
- Settings made by the owner and read back with `gh api`: the package is public, `gate` is required
  on `main`, the `release tags` ruleset covers `v*`, and the `github-pages` environment allows `v*`.

### The image at release

Read from the registry on 2026-10-27 with `docker buildx imagetools inspect ghcr.io/wizzywit/odudu:<tag>`;
each tag is an index of `linux/amd64` and `linux/arm64`.

| Tag          | Commit     | Index digest                                                              |
| ------------ | ---------- | ------------------------------------------------------------------------- |
| `0.1.0-rc.1` | `a8e9f609` | `sha256:9760e2eab06c85fb36bc432cd3553ca4d52b31892efc9f990bcaf60b97ec718e` |
| `0.1.0-rc.2` | `404268fd` | `sha256:2b51647dd7557c5e9d167cf3321c294206d13958f1f17b4cdd3f9c0c7b3a5b87` |
| `0.1.0-rc.3` | `146634f2` | `sha256:1186bed3c9d5c791206bfd559aa1400b7e3707ef28e10b29b30640cfda9d2c59` |

The `v0.1.0-rc.3` release assets are `compose.yaml` (`sha256:34bc715466926c9a8a0776598f001ecd2cece1fb257c54d4c9fba9e4c0bcd674`),
`odudu-sbom.json` (`sha256:36a7aa258b9bdb1f2d44d4ef1f56f15fd1d574ecc98acabc971ff0249b23017c`) and
`SHA256SUMS` (`sha256:8a45ff31da83a7ba357fbed71ca51e716eb79c90c88857730e36bfe9dcda81a4`).

### What was decided against

- Rspress for the site: it was evaluated and dropped for Docusaurus (the first spike above).
- A planned-feature list in the README, whether written or generated from the roadmap: the roadmap
  is the one place, so there is nothing to keep in step.
- Theming the 404 and 500 pages by tenant: they are standard pages.
- Making `cla` a required check before it has been tested from a second account.
- Fixing the required-action password gap and the append-only audit trail inside this phase: each is
  outside what the phase builds, and each names its phase (P4f and P12).
- For the long-heading transcript pages, the long heading as the page's title: a title is capped at 70
  characters and the heading is as long as 100. The rule instead: a page's `title` is a short name in
  words, the page's one heading repeats it, and the routes it covers open the page in a sentence that
  starts "This page covers". `tests/docs/admin-paths.test.ts` reads the routes from that sentence.

### The closing pass

- **Not implemented, placed and true.** The roadmap page no longer has a "What is not implemented"
  section; its Next, Later and Decided against parts are the list, held by
  `not-implemented-placement.test.ts`. Read item by item: the claims that the server publishes no MCP
  metadata (no `oauth-protected-resource` route), has no `Idempotency-Key` header (none in the code), no
  metrics route, no migration lock (`runMigrations` calls `migrate` and nothing else), ignores
  `acr_values`, refuses request objects (`request_not_supported`), exports at most 10,000 subjects
  (`EXPORT_SUBJECT_CAP`), and takes front-channel and `prompt=create` as shipped, all hold. Its
  reference to the SDKs (P4i, P14) and the hosted service are placed.
- **Phase numbers moved.** `git grep -P` over the README, the site, `docs/NEXT.md`, the umbrella spec
  and the ADRs found no citation of P10 for theming and none of P12 for the image. Reader pages carry
  no phase number outside the roadmap: the eight prose citations left on the transcript pages now name
  the roadmap instead.
- **`docs/NEXT.md`.** "What P4g, P4b and P4f inherit" is now "What P4b, P4f and P4h inherit", with
  the deployment paragraph moved under "What P11 and P12 inherit". The unscoped recovery-code count
  it asked P4f to re-scope was re-scoped in the replay, so the row and its spec clause are gone.
- **Section 11 and the roadmap, both ways.** The P4g row says what shipped, the SDK rows have their
  reasons, the totals are recomputed (1947–2854 and 1099–1549), and the error ID is on P4h only.
  `roadmap-section-11.test.ts` still maps every roadmap sentence for P4b to P14 to words in its
  criterion; the mapping for P12 gained the Node major.
- **The Node major.** Placed on P12, in the roadmap, as a row in `docs/NEXT.md` and as ADR 0001's
  amendment; Dependabot's ignore and its comment say the same.
- **Wording.** About 25 long sentences on the introduction, concepts, quick start and operating
  pages were cut or split. Twenty claims were read against the code: the eight built-in scopes, the
  30-minute and 10-hour session limits, the 300-second access token and 14-day refresh token, the
  90-day audit window, the 20 refusal rows per client per minute, the 16 MiB import body, the
  role check in `reap`, `send-mail` and `send-logouts`, the three ports, `ODUDU_ADMIN_EMAIL`, the
  optional `ODUDU_APP_DATABASE_URL`, `odudu seed restore-scopes`, `at+jwt`, an anonymous client
  requiring consent, the 114 admin operations, the 10,000-subject export cap, and the three missing
  server features above.
