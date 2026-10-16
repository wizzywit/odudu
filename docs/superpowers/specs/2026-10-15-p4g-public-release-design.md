# P4g — Public release: design

**Status:** draft for the owner's review · 2026-10-15
**Phase row:** [section 11 of the umbrella spec](2026-09-10-odudu-design.md), P4g.
That row is the exit criterion and is not restated here. This document
records what the brainstorm added to it, the calls made, and what is left to
the builder.

## Intent

Odudu is complete enough that somebody who has never heard of it should be
able to find it, run it, understand it and deploy it without asking the
people who built it. Today that is impossible: there is no published image,
the only documentation is four long Markdown files, the server's own pages
look unfinished beside the console, and nothing introduces the project.

The first ten minutes decide whether a developer stays. A stranger opens the
landing page, runs one command, and has a working identity provider they can
sign in to from an example application of their own kind (a server-rendered
app, a single-page app, an API, a machine-to-machine client). Everything
after that is the documentation they reach in one hop from the landing page.

**Odudu means "authority" in Ibibio, a language of Akwa Ibom, Nigeria.** The
name, the landing page and the README say so; it is context for what the
product is, an identity provider that holds authority on behalf of the
people who run it.

## Goals

- The exit criterion in section 11 for P4g, unchanged.
- One command takes a stranger from nothing to a signed-in admin console:
  it starts the stack, migrates the database, creates the system tenant and
  its first administrator, and ends by printing the console address and the
  administrator's sign-in. Run in a terminal it asks for the administrator's
  email and password; run without one (a script, a CI job) it takes them from
  environment variables, and when it is given neither it generates a password,
  prints it once and requires it to be changed at first sign-in. The CI job
  that proves the ten-minute claim signs in to the console this way.
- The landing page is the front door: it shows what Odudu is, the one
  command that runs it locally, and a way into the documentation, with
  restrained, smooth motion (CSS transitions and scroll-linked reveals; no
  animation library, nothing that blocks reading).
- The documentation is clean, mobile-first and looks and reads in the manner
  of the Vue documentation, without using Vue: it is built with a React
  documentation framework (Rspress, whose default theme is close to
  VitePress's), and the landing page is a React component in the same site.
  A guide path for each reader (a person signing in, an
  administrator, a developer integrating a client, an operator deploying it),
  each with examples that run, and a reference generated from the code.
- The server's sign-in, consent, logout and error pages use the console's
  design system, Instrument, so a person moving from the console to a sign-in
  page sees one product.
- Deploying it yourself is a documented path with a simple, copyable
  starting point.

## Non-goals and anti-goals

- **No hosted service in this phase.** The landing page has a "Hosted
  Odudu" section that says it is planned, with no payment, no sign-up that
  provisions anything, and no price. The hosted service is the paid layer of
  [ADR 0042](../../adr/0042-distribution-licensing-and-the-paid-boundary.md);
  it is not scheduled before P5 and is placed on the roadmap as such.
  Something on the landing page that looks purchasable and is not is a
  failure even if everything else works.
- No per-tenant or per-client branding (P4b). The default is Instrument.
- No translations (ADR 0043 gives P4g the catalogue mechanism in English,
  P4b the first other locale).
- Not a rewrite of the content. The three `*-paths.md` documents migrate;
  their commands stay executed in CI.

## Documentation moves into the site

The exit criterion in section 11 already names this; it is repeated here
because it is easy to read past.

- `README.md` becomes a standard front door: logo, tagline, badges, what it
  is and the meaning of the name, the one-command quickstart, links to the
  docs, examples, roadmap, contributing and security, and the licence. Its
  operating detail moves into the site.
- `docs/request-paths.md`, `docs/admin-paths.md` and `docs/console-paths.md`
  move into the site's source as guides and reference, with their commands
  still executed in CI and `tests/docs/` retargeted at the site. The three
  files are then retired, every citation of them repointed, and CLAUDE.md's
  documentation rules retargeted at the site's source.
- **The docs ship inside the image.** The same build that publishes the site
  is copied into the server image and served by it under `/docs`, so anyone
  running Odudu has the documentation for exactly the version they run, with
  no network. The hosted site is the latest release; the image's copy is
  the one that matches it. The pages are static files served from the
  server's own origin under a fixed policy of their own, in the way the
  console shell is (ADR 0029's amendment), and the image grows by the size
  of the built site only. The landing page itself is not in the image.

## The public site is found, fast and addressed from one place

A site nobody finds, or that is slow on a phone, does not do the work of a
front door. These are requirements of the phase, each held by a check
rather than by an instruction to keep it so.

- **Indexable.** Every page of the landing and the docs is pre-rendered
  static HTML with its headings and links in the markup; nothing a page says
  exists only after JavaScript runs, and a test over the built HTML holds it.
  Each page has its own `<title>` and meta description, a canonical URL,
  Open Graph and Twitter card tags with the social image, and an entry in
  `sitemap.xml`; the site has a `robots.txt`. The landing page carries
  JSON-LD for `SoftwareApplication` and `Organization`, docs pages carry
  breadcrumbs, and `<html lang>` is correct (`en` now) so a language added as
  a directory per ADR 0043 row 8 gets its own `lang` and alternates.
- **Fast.** Fonts are self-hosted with `font-display`, images carry their
  width and height and ship in a modern format, and nothing render-blocking
  comes from another origin. Lighthouse CI enforces Core Web Vitals and
  category minimums in CI on a throttled mobile profile against the landing
  page and a sample of docs pages (LCP under 2.5 s, CLS under 0.1, total
  blocking time as the lab proxy for INP), and an axe pass holds the landing
  page's accessibility. The numbers and why are in the plan, Task 31b.
- **The image's copy is never indexed.** The docs inside the image say
  `noindex` in their markup and in an `X-Robots-Tag` header, so a private
  installation never competes with the public site.
- **One address.** The site runs on the default `github.io` project path
  until the owner buys a domain. Its address and base path live in one file,
  and the canonical and Open Graph URLs, the sitemap and the Pages build all
  derive from it, so moving to a domain is one value, a rebuild and a Search
  Console step, written into `RELEASING.md`. A test holds that the address
  appears nowhere else. GitHub ignores a `CNAME` file when a workflow
  publishes the site, so the swap adds none (verified against GitHub's
  documentation, plan "Verified and assumed"). Vercel and Cloudflare Pages
  are named as alternative deploy targets with no commitment; as the owner
  understands it Vercel's free tier restricts commercial use, to be checked
  before relying on it.

## Brand

- The owner chose the **staff** direction from two rounds of sketches: a
  ring on a straight shaft with a short crossbar, a carried sign of
  authority, drawn as single-weight line geometry so it works as a favicon,
  in the terminal and at large sizes.
- The wordmark is lowercase `odudu` in a monospace face; this is a
  proposal, the owner confirms it.
- The phase draws the mark in SVG and the owner approves it; it is supplied at
  the sizes the site, README, favicon and social image need.
- **Risk accepted by the owner, 2026-10-15.** The owner believes the staff
  mark is not in use by another product and chose not to wait for a formal
  search. An informal web search the same day found no product, company or
  trademark filing named Odudu in identity or software; it cannot compare
  logos by eye, so this is not a clearance. A formal trademark and design
  search stays an optional step for the owner before any commercial use, and
  a change of mark after release means redoing the README, site, favicon,
  image labels and social image.
- Any glyph-like detail must be confirmed by someone who knows the Nsibidi
  tradition before use; nothing is copied from a real sign without that.

## Decisions made while brainstorming

| Decision                            | Call                                                                                                                                                                                                                                                                                                                    | By                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Hosted, paid service                | Not in P4g; landing page says it is planned; placed after P5                                                                                                                                                                                                                                                            | owner                            |
| Brand direction                     | Staff mark; monospace wordmark proposed                                                                                                                                                                                                                                                                                 | owner (mark), builder (wordmark) |
| Documentation framework             | Rspress (React), chosen over VitePress because the owner wants React, not Vue, with the Vue docs' look and feel                                                                                                                                                                                                         | owner                            |
| Landing page and docs are one site  | Rspress with the landing as a React home component, one source, one deploy                                                                                                                                                                                                                                              | my call                          |
| Where the site is served            | GitHub Pages from the release workflow, on a domain the owner supplies                                                                                                                                                                                                                                                  | my call                          |
| Search and speed of the public site | Required, and held by CI: built-HTML SEO tests and a Lighthouse CI budget (above); the image's copy is `noindex`; the address is one file                                                                                                                                                                               | owner                            |
| Motion                              | CSS only, respects `prefers-reduced-motion`                                                                                                                                                                                                                                                                             | my call                          |
| Roadmap                             | the hosted service gets an unnumbered placeholder row after P5 in section 11, in the first increment of this phase, so nothing is renumbered                                                                                                                                                                            | my call                          |
| Repository                          | already public; GHCR package visibility, Pages and private vulnerability reporting are switched on by the owner when each increment needs them                                                                                                                                                                          | fact                             |
| Site URL until a domain exists      | the default `github.io` project path; the address and base path are one file, and the domain is a change to its two values                                                                                                                                                                                              | my call                          |
| Guide commands in CI                | run against the one-file compose quickstart and the published image, the same job that proves the ten-minute claim                                                                                                                                                                                                      | my call                          |
| Instrument on server pages          | a stylesheet the server serves from its own origin, generated from the console's tokens, with a CSP `style-src 'self'` amendment to ADR 0029; no inline CSS, no remote fonts; the "does Instrument reach every renderer" check sits beside `html-response.test.ts`; the builder decides the details inside those limits | my call                          |

## Left to the builder

The information architecture (section 11 refers to it), the choice of each
example application's framework, the quickstart's exact commands, how the
docs build pulls the OpenAPI document, CLI help and configuration loader
into reference pages, the increment order, and the performance and scale
statement for the site and the image (the server paths this phase touches
are page rendering and message catalogues; the bound is the same as today).

## Open for the owner

- The domain for the site, wanted early (by the docs increment, not the
  deploy): canonical URLs, sitemap entries and inbound links accumulate on the
  address in use, and an owned domain is the better one to build them on.
- Approval of the finished mark, which the phase draws from the staff direction.
- Who confirms any Nsibidi-inspired detail.
