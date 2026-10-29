# P4b — theming and client branding

**Status:** draft for owner approval · 2026-10-27
**Phase row:** section 11 of
[the umbrella spec](2026-09-10-odudu-design.md), "P4b". This spec narrows
that row; where it differs, it says so in "What leaves P4b".

## 1. Intent

A tenant's end users should meet the tenant's product, not Odudu's: its logo,
colours, wording, language and, where it wants, its layout, on every page the
server shows and in its mail. A tenant with several applications should be able
to give each one its own look. The tenant's administrator is not trusted with
the page's security surface, so control is as wide as it can be made while the
session, the hidden fields and the submit stay the server's.

Terms: a **theme** is a tenant's or a client's branding. A **colour scheme** is
the light/dark choice that `PageTheme` in `@odudu/kernel` already models; the
two are unrelated and the code keeps the words apart.

## 2. Goals, non-goals, anti-goals

**Goals**

- Every `*-html.ts` renderer reaches a theme, enforced by a build check.
- A tenant sets tokens, images, one stylesheet and one template per page kind.
  A client overrides any of those, piece by piece, over the tenant's theme.
- Uploads are stored and served by Odudu from its own origin.
- Mail follows the tenant's tokens, logo and wording.
- Tenant locales, per-locale message overrides, localised client and scope
  metadata, and Arabic shipped as the right-to-left locale.
- A Branding area in the console and the same operations in the admin API,
  with draft, preview, publish and a way back.
- Logout confirms by default, a client can opt out with a clearly warned
  setting, and the form's fields are bound into the anti-forgery token.

**Non-goals**

- A custom domain per tenant (moves out, section 3).
- Template logic (conditionals, loops): decided against for now, section 6.
- SVG uploads, and font uploads. Raster images and Instrument's self-hosted
  fonts only.
- Tenant-written mail templates (section 9).
- The console's own localisation (P4h).

**Anti-goals** — outcomes that fail the phase even if the tests pass:

- A theme that can drop, duplicate or forge the form, a hidden field or the
  submit.
- A theme, or an upload, that can run script on Odudu's origin.
- A page whose CSP was widened for every tenant to make one tenant's theme work.
- A preview that renders differently from what users get.

## 3. What leaves P4b

**A public address of its own for each tenant (a custom domain)** moves to a
new phase straight after P4b, here called **P4j** (a name this spec chose; the
owner may rename it). Reason: it changes how a tenant is resolved (from `Host`,
not from `/tenants/<name>`), the issuer, cookie scope, the WebAuthn RP ID
(passkeys are bound to a domain) and certificate provisioning, and none of it
changes how a page looks. Its design: the operator's reverse proxy terminates
TLS and asks Odudu whether a domain is registered (Caddy's on-demand TLS shape);
Odudu keeps a table of verified domains, resolves the tenant from the host and
serves its routes at the root. Automatic certificates inside Odudu stay with
P11.

Writing this down is part of P4b's documentation, not a follow-up: the roadmap
line and its "translated pages and mail" neighbour, section 11's P4b row and a
new P4j row, `docs/NEXT.md`, and the mapping in
`tests/docs/roadmap-section-11.test.ts`.

**Liquid-style template logic** is added to the roadmap's "Decided against":
slot templates, per-client themes and per-locale text cover the common cases;
logic adds a sandboxed engine and execution limits to the attack surface;
revisit when a user asks for it, and place it then.

## 4. Constraints

- Volume: 10,000 tenants, 10,000 clients per tenant, a page render makes a
  constant number of queries, and any in-process cache states its bound
  (ADR 0041, CLAUDE.md "Performance and scale").
- Layering and the no-`any`, no-`void`, comment and commit rules in CLAUDE.md.
- Every repository method probed with a foreign `tenant_id`; tenant context by
  `SET LOCAL`.
- A user-facing string is a catalogue entry (ADR 0043); the Branding area's own
  wording lives in the console's `service` constants until P4h.
- A renderer keeps returning `RenderedPage`; a theme replaces `body` and
  `title`, never the document (ADR 0030).
- `pageHeaders` in `@odudu/kernel` stays the one authority for headers
  (ADR 0029).

## 4a. Behaviour at the design volume

ADR 0041's volume: 10,000 tenants, 10,000 clients per tenant, 1,000,000
subjects. Each path this phase adds:

| Path                    | At volume                                                                                                                                                                                                                                                                         | Held by                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Rendering a page        | at most one theme query on a cache miss (tenant and client rows together, by index), none on a hit; the cache is an LRU of 5,000 entries with a 30-second TTL, keyed by tenant, client and published version; the fill is linear in a bounded template (size and slot-count caps) | `query-plans` drives a sign-in render and counts statements |
| Serving an asset        | one primary-key read on `(tenant_id, sha256)`, then `Cache-Control: immutable`, so a proxy or CDN absorbs repeats; `bytea` is read by this route alone                                                                                                                            | plan check on the lookup                                    |
| Theme and version reads | a scope has at most one draft, one published and 20 archived rows; no list is unbounded                                                                                                                                                                                           | the cap, and the partial unique indexes                     |
| Message overrides       | at most 500 per tenant; the list is keyset-paged under `MAX_LIMIT`                                                                                                                                                                                                                | the cap, the plan check                                     |
| Per-locale metadata     | a `jsonb` map beside the row, so a client list or consent page makes no extra query; at most 32 entries per map                                                                                                                                                                   | the existing list-statement-count check                     |
| Tenant storage          | 8 MiB of uploads per tenant (about 80 GB at 10,000 tenants as the worst case; typically far less); blobs sit in their own table                                                                                                                                                   | the cap; P11 measures                                       |
| Foreign keys            | every new foreign key has an index, so deleting a client or tenant reads no child table whole                                                                                                                                                                                     | `unindexedForeignKeys` in the plan test                     |
| Preview                 | one render, assets inlined up to about 2.2 MiB (a background at its limit, as base64, and room for the rest), admin-only, not a public path                                                                                                                                       | the size bound                                              |
| Console                 | the Branding feature is a lazy route outside the entry chunk, the editors are not imported by the entry, lists are paged, no hand-written memoisation                                                                                                                             | the chunk budget and the compiler lint                      |

**Not claimed:** the cache is per process, so after a publish another replica
serves the previous version for at most the 30-second TTL. Shared invalidation
belongs to P11 with the other in-process bounds.

## 5. Approaches considered

Choice of how a theme is expressed, grounded in how Auth0, Keycloak and Okta
work (research, 2026-10-27):

|                       | Trade                                                                                                                                   |                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Slot templates** | HTML per page kind with named slots and catalogue references, no logic; sanitised at save, checked for required parts, filled at render | **Chosen**                                                                                                                                                             |
| B. Structured theme   | tokens, ordered blocks and wording, no tenant HTML; safest, least flexible                                                              | Rejected: the owner wants as much control as possible                                                                                                                  |
| C. Liquid-style       | slots plus conditionals and loops, as Auth0; most power                                                                                 | Rejected for now: needs a sandboxed engine, execution limits and a far larger attack surface; A grows into C without redoing the sanitiser or the required-parts check |

Scope of a client's override, three options:

|                                              | Trade                                                                                                     |                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens, images and stylesheet only           | one set of templates to validate                                                                          | Rejected: Keycloak sets a login theme per client and Auth0 users fake it with conditionals; the owner wants each client able to look different |
| **Any piece, templates included**            | the client's theme has the tenant theme's shape, layered one piece at a time; one sanitiser, one renderer | **Chosen**                                                                                                                                     |
| A separate theme per client with no fallback | N complete themes                                                                                         | Rejected: a new client would start unstyled                                                                                                    |

Storage of uploads: **PostgreSQL `bytea` in its own table**, over a volume or
object storage, because Odudu ships as a container and a database, `bytea`
holds files this size, backups and tenant deletion come with the database, and
a small storage interface lets object storage replace it later. At a million
tenants the ceiling is about 1 TB and a realistic figure tens of GB; P11 owns
measuring that.

## 6. The theme model

A theme has one shape, held at two scopes (tenant, and client within a tenant):

- **tokens**: colours and a font choice from Instrument's self-hosted set, for
  light and dark.
- **assets**: logo (with required alt text), favicon, background image, and an
  optional dark-scheme logo (a dark logo can vanish on a dark background).
- **stylesheet**: one, sanitised.
- **templates**: one per page kind, each optional.

Resolution for a page: the client's piece, else the tenant's, else Instrument's.
This is per piece, so a client can override only the sign-in template and the
logo. The console and the API show which layer supplies each piece.

**Tokens are overridden as groups, never one colour at a time**: the light
palette, the dark palette and the font are three groups, each complete. A
client that overrides a group replaces all of it, so contrast is checked within
a group at publish and a later tenant publish cannot break a client that
inherits nothing from the group it overrides. Publishing never fans out over
clients.

**Which client a page has.** A page reached through an authorization request
takes its client from the stored authorization session, server-side, never
from a parameter the user can edit. A page reached from a mailed or linked
address (registration, verification, reset) takes it from `return_to` where the
flow already carries one, accepted only when it names a registered client of
the same tenant; otherwise, and for a hintless logout and every error page that has a
tenant in scope, it uses the tenant's theme. A logout takes a client only from an `id_token_hint`
verified for a registered, enabled client of the tenant, carried to the
confirmation POST by the form token; a `client_id` parameter alone never.
Mail uses the tenant's theme only. No flow gains a stored client id.

**A page that needs a script** (passkey enrolment) gets it as a required
server-emitted slot, `{{script}}`, in that page kind's manifest, carrying the
nonce its `RenderedPage` names; the hostile-theme test checks the nonce
survives.

### 6.1 Slot templates

A template is HTML with slots. The renderer declares, per page kind, a manifest
of **parts**: the form open tag with its hidden fields, each input, the submit,
errors and links, each as a named slot (`{{form.open}}`, `{{field.password}}`,
`{{submit}}`, `{{error}}`), plus `{{t "key"}}` for a catalogue entry in the
negotiated locale. The server emits every part itself; a template places them.

Checked when a draft is saved and again when published:

- every required part appears exactly once, and an unknown slot is refused;
- the HTML passes a fail-closed allowlist: no `script`, `style`, `link`,
  `meta`, `base`, `iframe`, `object`, `embed`, `form`, `input`, `button`,
  `select`, `textarea` or `svg`; no event-handler or `style` attributes; `class`,
  `lang`, `dir`, `aria-*` and `role` allowed; `a href` https only with
  `rel="noopener noreferrer"`; `img src` only a hashed asset URL of the same
  theme. Anything not recognised is refused, not passed through (a sanitiser that
  copies what it does not match is how a CSS sanitiser was recently bypassed);
- size and slot-count bounds.

At render time a theme that fails any check, or whose referenced asset is gone,
falls back to the layer below it, and the fallback is logged.

### 6.2 Stylesheet

One stylesheet per theme, sanitised by a property and value allowlist that fails
closed: no `@import`, no `url()` except the theme's own asset URLs, no
`@font-face`, no `expression`, `behavior` or `-moz-binding`, selectors scoped to
the page's documented class hooks. The hooks are published and versioned; the
research found Auth0 warning that generated class names change on every build,
so ours are a stable contract. It is served as a hashed same-origin file, so
`style-src` has no `'unsafe-inline'`.

**Accepted:** a stylesheet can restyle or hide any visible element. A tenant
already owns its users' sign-in experience and could clone the page; hiding the
submit only breaks the tenant's own page. What it cannot do is read a field's
value out (no external URL) or run script.

### 6.3 Content-security policy

Derived from the resolved theme: `img-src` and `style-src` list that theme's
asset and stylesheet URLs explicitly instead of `'self'`, so a page can load
only what its own theme owns. `pageHeaders` takes the list from the
`RenderedPage` the way it takes a script nonce, and a page with no theme is
unchanged.

A branded page's CSP lists the theme's own URLs as origin + path. `origin`
must equal the origin the page is served from (the configured public base
URL); a mismatch fails closed, the page loading unstyled while forms still
work. A URL ending in `/` is refused, since a trailing slash is a prefix match
in a CSP, and `//` or a dot segment never matches a request path. The resolver checks `brandingProblems` and falls back to the default
theme, logging the reason (ADR 0030's amendment).

## 7. Uploads

- PNG, JPEG, WebP only. Type decided by the file's leading bytes, never the
  `Content-Type` header (OWASP File Upload Cheat Sheet); the server generates
  the name; raster images are decoded and re-encoded, which strips metadata and
  anything appended.
- Limits per image (bytes and dimensions) and a per-tenant byte cap.
- A `theme_assets` table, separate from the rows that describe a theme, never
  selected in a list or a page render; content-hashed URLs under the tenant's
  path; `Cache-Control: public, immutable`, `X-Content-Type-Options: nosniff`.
- Deleting a tenant deletes its assets; a replaced asset is removed when no
  published or draft version references it.

## 8. Draft, preview, publish, restore

- Edits save as a **draft**; users see nothing. A draft is a whole-theme
  snapshot, one per scope (the tenant, or one client), and a version is the same
  snapshot published. Publish and restore act on the whole theme. The console's
  `412` rebase applies to the draft.
- A draft's unpublished assets are never served publicly.
- **Preview** renders the real renderer for a page kind with sample data, through
  the production render path and sanitiser, as a response of its own with its
  real headers, not as `srcdoc` (a Mozilla CVE showed sandboxed `srcdoc` frames
  did not inherit the page's CSP). The console frames it with `sandbox` and
  without `allow-same-origin`. Pages deny framing today; the preview route is the
  one narrow exception, admin-session only, `frame-ancestors` the console and no
  other route changed. The frame's own document loads with the admin's session
  cookie (console and server share an origin: the SPA calls `/console/api/*`);
  its sub-resources load without credentials because the preview inlines the
  draft's stylesheet and images (`data:` URIs, size-bounded) under that
  response's own CSP, so no draft asset needs a public URL. A page needing script
  (passkey enrolment) previews without it and says so.
- **Publish** runs every check. Contrast is computed for each token pair
  (4.5:1 text, 3:1 large text and UI components, WCAG 1.4.3 and 1.4.11) and a
  failure blocks publishing; a stylesheet or template cannot be proven to pass,
  so it earns a warning.
- Previous published versions are kept (bounded count); one action restores one.
  **Reset to default** returns a tenant to Instrument, or a client to its tenant.

## 9. Mail

Verification and reset mail take the tenant's tokens, logo and wording, inline
in the existing mail shell in `packages/email`. Mail clients drop `<style>`
blocks and block remote images by default, so there are no tenant mail
templates; the logo carries width, height and alt text; every element gets
explicit colours and the dark-scheme logo is used under `prefers-color-scheme`.
Embedded or linked logo is chosen by testing in real clients (the research did
not rank them); the plan holds that as a spike. A mail's locale is the
recipient's `users.locale`, else the tenant default.

## 10. Locales

ADR 0043 is the design; this phase delivers its tenant part.

- Tenant settings: supported locales and a default; `ui_locales_supported` in
  discovery becomes the tenant's list.
- Message overrides `{ locale, key, message }`, per tenant, bounded in count, a
  key absent from `en` refused, escaped like any catalogue value.
- `name_i18n` and `description_i18n` maps on `clients`, and `description_i18n`
  and `consent_text_i18n` on `client_scopes` (a client has no `consent_text`
  column; checked: `grep -n consent_text packages/domain-tenant/src/schema/`),
  each `'{}'` by default with the base column the fallback, keys through
  `isValidLocale`, the admin API, a locale-tabbed editor, the consent page
  reading them, and Dynamic Registration's `client_name#fr` form.
- **Arabic** ships, complete for every page and mail key, laid out under axe in
  right-to-left. A machine draft is not shippable as the first non-English
  locale: review by a reader of Arabic is an owner step in `RELEASING.md`. The
  drafted catalogue merges on the branch, complete for every key, and the
  phase closes with that step open, as P4g closed with the stable tag open; no
  release is cut until the review is done.

## 11. Sign-out

`/logout` shows its confirmation page by default (OIDC RP-Initiated Logout 1.0:
the OP "SHOULD ask"; its security section calls a hintless logout a
denial-of-service vector and asks for explicit confirmation). The form's
`client_id` and `post_logout_redirect_uri` are bound into the anti-forgery
token. An expired `id_token_hint` still identifies the session (the spec says to
accept it).

**A client may opt out of the confirmation.** A per-client setting,
`skip_logout_confirmation`, is off by default. When it is on, and only then,
`/logout` ends the session and redirects without asking, provided the hint's
signature verifies, its audience is that client and its `sid` is the live
session's. No hint, an invalid hint, a hint for another client or another
session still ask, and so does every client with the setting off. Dynamic
Client Registration never accepts the field, so an unauthenticated registration
cannot turn it on. The console's own client has it on, because its ID token is
held server side and its sign-out is a click in an authenticated, anti-forgery
protected page. Keycloak skips the page for any hint; this is the same
convenience, opt-in per client.

The residual risk is the one the confirmation closes: anyone holding an ID
token that client received, even an expired one (the spec says to accept
expired hints, and the console's five-minute tokens need it), can force that
sign-out with a `GET` while the session lasts.
The client's page in the console says so in plain words next to the setting
(section 13), and the setting is changed only through the admin API with the
`manage-clients` capability, audited like any client change.

## 12. Accessibility

Logo alt text required. Axe runs over every page kind, in both colour schemes,
under Instrument, a realistic theme and a deliberately hostile theme. The
roadmap criterion "every such page passes WCAG 2.2 AA under axe" is reworded:
Odudu's markup and any theme built from checked tokens pass; a tenant's own
stylesheet and templates get a publish-time warning and are the tenant's
responsibility, because no server-side check can prove them.

## 13. Admin API and console

- Admin API under `/admin/tenants/{tenant}/`: theme (get, draft, publish,
  restore, reset), assets (upload, delete), a client's theme beside the client,
  locales and overrides, previews. Capability roles as for every admin route.
- Console: the client's Logout tab holds the `skip_logout_confirmation` toggle with this warning, worded as a service constant: "When this is on, anyone who holds an ID token this application received, even an expired one, can sign its users out by opening a link while their session lasts, with no confirmation. Turn it on only for an application you run yourself whose ID tokens never reach a browser or a log." It is off for every new client.
- Console: a **Branding** feature with Theme, Pages, Mail and Languages tabs,
  and a Branding tab on a client. Five layers, one `index.ts`, Instrument
  components, a draft keyed by tenant and record, a rebase on `412`.
- Docs owed in the same commits (CLAUDE.md): the transcripts re-run, the
  console area page and `tour.mdx` with `pnpm docs:screenshots`, the server-page
  screenshots (`pnpm --filter @odudu/docs page-shots`), the `concepts/` and
  guide pages, the roadmap and section 11 edits, and the closing-pass greps.

## 14. Where it beats, matches or lags the standard

| Point                            | Standard or common practice                              | This design                                           |
| -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Template with server-owned parts | Auth0: required `head` and `widget` tags                 | Matches, finer-grained: every form part is a slot     |
| Per-client look                  | Keycloak native; Auth0 by conditionals; Okta by clientId | Matches Keycloak, piecewise fallback                  |
| Logout confirmation              | Spec SHOULD; Keycloak skips with a hint                  | Meets the spec, closes the leaked-token case          |
| Sanitiser                        | A recent CVE: unmatched CSS passed through               | Fail-closed                                           |
| CSP                              | Often widened per tenant                                 | Per-theme URL list, `'self'` not widened              |
| Preview                          | Auth0 preview lags and can differ from saved             | Same render path, layer provenance, versions, restore |
| Upload validation                | OWASP: bytes not header, generated names                 | Matches, adds re-encoding and `nosniff`               |
| Template logic                   | Auth0 Liquid                                             | Lags by decision, section 3                           |
| Fonts, SVG                       | Common in competitors                                    | Lags by decision, section 2                           |

## 15. Exit criteria (draft of the section 11 row)

1. Every `*-html.ts` reaches a theme, and a build check beside
   `html-response.test.ts` fails when one does not; any renderer without a tenant
   in scope is named in the check with its reason.
2. A tenant theme set through the admin API and the Branding area renders on
   every page without a rebuild; a client override applies piece by piece;
   draft, preview, publish, restore and reset work, preview through the
   production path.
3. A hostile-theme test per renderer: the session id, hidden fields, CSP nonce and
   submit survive, and the form posts.
4. Uploads as section 7, with hostile files (polyglot, oversize, wrong type,
   decompression bomb) refused.
5. The CSP is per theme, and a test shows a page cannot load another theme's
   asset.
6. Mail themed per tenant under the section 9 rules.
7. Locales, overrides, localised client and scope metadata, and Arabic as
   section 10, with axe in right-to-left.
8. Logout as section 11, with a test that a valid hint alone does not end the
   session.
9. Axe over every page kind, both colour schemes, under Instrument, a realistic
   theme and a hostile theme: Odudu's markup and checked-token themes pass; a
   tenant's own stylesheet and templates get a publish-time warning (section 12).
10. Cross-tenant RLS probes on every new table and method; each new path states
    how it behaves at the volume in section 4.
11. The roadmap, section 11, `docs/NEXT.md` and the placement tests carry the
    P4j move and the Liquid decision.
12. The documentation describes what now exists, each part with its check
    (CLAUDE.md, "The documentation an increment owns"):
    - **Transcripts**, re-run on a live stack: the theme, asset, locale and
      client-branding admin routes, a rejected template and a rejected upload,
      the always-confirm logout, and the themed sign-in and consent pages.
      Response blocks carry no language tag, and each says what ran before it.
    - **Console**: a `branding` page under `admin-console/`, the client page's
      new tab, `tour.mdx`, then `pnpm docs:screenshots`.
    - **Server pages**: the landing strip's screenshots regenerated with
      `pnpm --filter @odudu/docs page-shots`, so `drift.test.ts` stays green.
    - **Landing page**: the "Branding and theming" band
      (`features/landing/service/content.ts`, `BRANDING`) stops being a
      "Planned" item and shows a real tenant theme beside the default, with its
      claim, alt text and tests updated; the "Planned" rows that name P4b are
      removed.
    - **Concepts and guides**: a branding concept page (themes, layers, parts and
      slots, the safety model, the CSS hooks as a versioned reference), a guide
      that brands a tenant and a client with runnable blocks, the sign-out
      behaviour in the sessions concept, and locales and overrides in the
      localisation page.
    - **Reference**: the generated endpoints and OpenAPI follow from the code;
      error codes for each refusal are documented; `README.md`'s feature list and
      `tests/docs/questions.md` entries that say "Planned (P4b)" are corrected.
    - **Roadmap**: P4b leaves "Next", its capabilities leave "What is not
      implemented", and the not-implemented markers are read for truth in the
      closing pass.

## 16. What is left to the builder

- A first increment that lists every renderer and records, with a reason, each
  one that has no tenant in scope; the resolver and the build check follow from
  that list.
- Table shapes, migration numbers and indexes (grep for the next free number).
- The slot grammar's exact syntax, the part manifests per page kind, and the
  page-kind registry.
- The sanitiser: library or hand-written; either must fail closed and be
  fuzzed with hostile fixtures.
- Cache and its bound for resolved themes.
- Whether any current renderer uses inline `style` attributes (this design needs
  none; verify by grep before the CSP task).
- Decision records: ADRs for the template model, the upload store and logout
  confirmation, numbered when written.
- Increment order, with each ending green and independently mergeable.
- Hours: the row's 81–134 h included the custom domain; re-estimate without it.

## 17. Open for the owner

- The name and number of the new custom-domain phase.
- Native review of the Arabic catalogue before release.
