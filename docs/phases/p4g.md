# P4g — public release

What the phase found while building it, in the shape `docs/phases/p4e.md`
follows. The phase's argument is in
[its design](../superpowers/specs/2026-10-15-p4g-public-release-design.md)
and [its plan](../superpowers/plans/2026-10-15-p4g-public-release.md).

## Spikes

### The site: Rspress, first pass in a scratch directory

The owner chose a React documentation framework over VitePress on
2026-10-16. Rspress 2.0.23 was installed outside the repository
(`pnpm add -E @rspress/core@2.0.23 react@19.3.0 react-dom@19.3.0`, Node
24.15.0, pnpm 12.3.4, Playwright 1.63.0 on its cached Chromium) and each
claim the plan depends on was run there. The plan's Task 1 repeats them inside
a worktree of this workspace; what follows is what the scratch run
established.

- **Version and engines.** `npm view @rspress/core version` is `2.0.23`
  (published 2026-09-29; `2.1.0-beta.1` is the newest beta; the unscoped
  `rspress` package is the 1.x line). Node `^20.19.0 || >=22.12.0`, React
  `^19.2.8` as a dependency. A scratch workspace with this repository's
  `minimumReleaseAge: 1440`, `engine-strict=true` and `allowBuilds`
  installed it with one `react` (19.3.0, the console's pin), no `vite` and no
  build-script warning.
- **Base.** `rspress build --base ./` emits `/./static/...`, so a relative
  base does not exist and the site is built twice (`--base /odudu/`,
  `--base /docs/`). The persistent build cache is not keyed by base: a
  `/docs/` build after a `/odudu/` build still said `/odudu/` until
  `builderConfig.performance.buildCache` was `false`; four alternating
  builds were then each correct.
- **Inline script and style.** One inline `<script>` per page (520 bytes,
  identical on every page). Over the three path documents (1,408 code blocks),
  20 distinct `style=""` values. Three `<style>` elements are injected in the
  browser (empty, medium-zoom's, the mobile menu's body lock). Under
  `default-src 'self'; script-src 'self' <hash>; style-src 'self' <3 hashes>;
style-src-attr 'unsafe-hashes' <20 hashes>; connect-src 'self'` a
  Chromium walk (search, theme toggle, code copy, mobile menu at 390 px)
  reported no violation. The hashed policy stands.
- **Markdown.** In `.md`, `{{ }}` and `{ }` are literal; a real HTML tag in
  prose is parsed (a `<script>` in prose becomes a live inline script).
  All 1,408 fenced blocks of the three documents rendered byte for byte.
  The three documents build as single pages in 4.7 s (2.5 MB, 2.5 MB and
  0.55 MB of HTML), so the split by section is required.
- **Links.** A dead page link fails the build by default; with
  `markdown.link.checkAnchors` a dead anchor does too.
- **Search.** Built in, one same-origin `search_index.<lang>.<hash>.json`
  (1.28 MB for the three documents); nine hits for a term, no request to
  another origin.
- **Home and theme.** `pageType: custom` renders the nav, search and theme
  switch around an MDX-imported React component. `--rp-*` overrides apply,
  and the console's `tokens.css` imports by relative path from outside the
  site's root. Under `prefers-reduced-motion: reduce` a gated reveal computes
  `animation-name: none`. Without `output.overrideBrowserslist` set to modern
  browsers, Rspress's CSS pipeline rewrites `light-dark()` into a
  `prefers-color-scheme` hack that ignores the theme toggle; with it all four
  system/toggle combinations follow the toggle.
- **First-load JavaScript** is about 172 KB gzip plus 12 KB of CSS, over the
  150 KB the landing spec first assumed; the budget is 200 KB.
- **Languages and images.** `content/en/` builds at `/`; an added
  `content/fr/` with a `locales` entry builds `/fr/` with its own search
  index and a switcher; `content/public/` reaches the site root;
  `route.exclude` plus a plugin's `addPages({ routePath: '/' })` gives the
  image a plain documentation home with no landing text in its output; a
  `?raw` import with `CodeBlockRuntime` renders an example file byte for
  byte.

Not verified in scratch, and carried by the plan as assumptions: lychee over
the prefixed built site, this repository's ESLint and `tsc` over an Rspress
app, the canonical `<link>` through the `head` option, and the landing's
fallback in a browser without `animation-timeline` (Playwright's Firefox and
WebKit builds were not installed).

### The site: search metadata and Lighthouse, scratch run

Added 2026-10-16 with the requirement that the public site be found and
fast. Run in a scratch directory (`@rspress/core` and
`@rspress/plugin-sitemap` 2.0.23, `@lhci/cli` 0.15.1, Playwright's Chromium).

- **Head.** Rspress writes `<html lang="en">`, a per-page title, meta
  description and `og:title`/`og:description` from front matter. A `head`
  function of `{ routePath }` emits a per-page canonical and `og:url`, and
  returning `undefined` omits the tag, which is how the image build gets
  `noindex` and no canonical. Rspress emits no canonical itself. JSON-LD
  returned from `head` arrives intact; the same string in front matter arrives
  as an empty script, so JSON-LD goes through `head`.
- **Sitemap.** `@rspress/plugin-sitemap` writes root-relative `<loc>` unless
  the top-level `siteOrigin` is set, then absolute; `lastmod` is the file's
  mtime. `siteOrigin` also builds `hreflang` alternates (code read, not run).
- **Lighthouse.** `lhci autorun` against `rspress preview` collects and
  asserts; its default is the throttled mobile profile. A stock page scored
  performance 0.99, accessibility 0.89, best practices 0.96, SEO 1.00, LCP
  1,954 ms, CLS 0, TBT 0. The accessibility loss is the stock theme
  (`aria-hidden-focus` on the heading anchor, `color-contrast`) and the
  best-practices loss a `404` for `/favicon.ico`: the gate fails on the stock
  theme until the site fixes them. `rspress preview` does not compress.
- **Custom pages.** A `pageType: custom` landing is server-rendered: its
  headline, command and links are in the built HTML with scripts stripped.
- **GitHub Pages.** A `CNAME` file is ignored when a workflow publishes the
  site, so a domain swap adds none. The apex and `www` DNS values are in the
  plan. GitHub's custom-domain page does not say the old `github.io` URL
  redirects; that stays an assumption until the swap is run.

Carried by the plan as assumptions: the `hreflang` alternates for a page in two
languages, a Chrome on `ubuntu-latest`, the theme change that clears
`aria-hidden-focus`, `releases/latest/download` resolving to the newest
non-prerelease asset, and the PNG social image reading well in link previews.
