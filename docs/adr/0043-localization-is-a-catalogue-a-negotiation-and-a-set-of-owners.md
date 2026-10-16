# 0043 — Localization is a catalogue, a negotiation and a set of owners

**Status:** Accepted · 2026-10-15

## Context

Nothing in the roadmap or in any ADR placed localization. The parts of it that
exist are accidents of other work.

- `/authorize` accepts `ui_locales` and `claims_locales` and ignores them, a
  documented decision under OIDC Core §15.1 (`docs/request-paths.md`,
  "`/authorize`").
- A subject has a `locale` attribute (`packages/domain-identity/src/schema/users.ts`,
  `packages/contracts/src/admin/profile.ts`) and the console offers a picker
  for it, validated by `isValidLocale`
  (`packages/contracts/src/profile-claims.ts`). Nothing reads it to choose a
  language.
- Every server page is English, written into one of fifteen `*-html.ts`
  renderers across four packages' `view` layers; the mail templates are
  English in `packages/email/src/service/templates.ts`; the console's wording
  is English in `service` constants and a few hundred literals.
- One line of the P4d gap audit said "translated pages and mail" and gave it to
  P4b. That named the work and none of its parts: who picks the language, where
  the text lives, what a right-to-left language does to a layout, or how a
  client's name reads in French on a consent screen.

"Support every locale" is not one task, and a plan that covers only translated
text leaves the rest implicit. This ADR decides the mechanism once and gives
every dimension of locale support an owner or a stated refusal.

## Decision

### The mechanism

**A message catalogue per package that renders text.** One JSON file per
locale in the package (`catalogue/en.json`, `catalogue/fr.json`), a flat map
from a stable message ID to an ICU MessageFormat string. A package holds the
text of its own pages; there is no central catalogue that every package must
reach into. The IDs are named for the thing, never the wording
(`login.title`, `consent.scope.optional`), and an ID is never reused for a
different meaning. `en` is the source: a key exists there first.

**ICU MessageFormat for anything with a number, a gender or a choice in it.**
Hand-written `count === 1 ? 'one' : 'other'` is English's rule only. The
library is `intl-messageformat`.

- `assumption:` it parses ICU syntax, runs on Node and in the console bundle,
  and picks the plural category through `Intl.PluralRules`. P4g spikes this,
  with the console bundle's size measured against ADR 0041's chunk budget,
  before the task that depends on it.
- `verified: node -e 'new Intl.PluralRules("ar").select(n)'` over 0, 1, 2, 3,
  11, 100 on Node 24.15 returns `zero,one,two,few,many,other`; `"pl"` over 1,
  2, 5, 22 returns `one,few,many,few`; `"ja"` over 1 returns `other`. The
  platform has the plural rules, so the catalogue's plural arms are the only
  thing the library adds.

**Locale tags are validated by `isValidLocale` before they are used for
anything.** Its shape is `language[-script][-region]`
(`LOCALE` in `packages/contracts/src/profile-claims.ts`). A tag carrying a
variant or extension subtag (`de-CH-1996`, `en-u-ca-iso8601`) is reduced to
that shape before matching, not refused.

### Negotiation, for a page shown to an end user

In order, first match wins, each candidate matched against the tenant's
supported list (and ultimately the catalogue's shipped locales) by RFC 4647
**lookup**:

1. `ui_locales`, the first tag it lists that is supported (OIDC Core §3.1.2.1
   says the value is "in order of preference").
2. The signed-in subject's `locale` attribute, **only once the subject has
   authenticated** (see below).
3. The tenant's default locale, where the tenant has set one.
4. `Accept-Language`, by quality value; at most 16 entries and 1,024 bytes
   are read (an in-process bound stated per ADR 0041).
5. `en`.

A request with no authenticated subject and no `ui_locales` therefore uses
the tenant's default, then the browser's preference, then `en`.

**The subject's `locale` is not consulted before the first factor is
verified.** A language that changes after a username is typed tells whoever
is typing whether that account exists, and for an account without a `locale`
whether it exists at all. The pages before that point (the login form, the
refusal page) negotiate on steps 1, 3, 4 and 5 alone.

A tenant's default is optional. Unset, the browser's preference decides; set,
it overrides the browser and nothing the person asked for explicitly.

Lookup truncates from the end: `zh-Hant-TW` tries `zh-Hant-TW`, `zh-Hant`,
`zh`, then falls to the next candidate. The negotiated locale is rendered into
`<html lang>` and `dir`, and into `Content-Language`.

`dir` is read from a table in the repository (the right-to-left languages
Odudu ships or a tenant adds), with a test comparing it with the platform.

- `verified: node -e 'new Intl.Locale("ar").getTextInfo().direction'` returns
  `rtl` and the same for `he`, on Node 24.15. `assumption:` browsers expose
  `getTextInfo` too, which is why the table, not the call, is the authority.

### What is localised, and what is not

| Localised                                                 | Not localised, and why                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| every page an end user is shown (each `*-html.ts`)        | protocol `error` and `error_description`: developer-facing (RFC 6749 §4.1.2.1, §5.2)     |
| the mail templates                                        | a problem document's `detail`: it is for the developer; its `errors[]` get codes (below) |
| the admin console's own wording                           | audit data, logs and metrics: they are records, read by operators across locales         |
| a client's name and a scope's text, as a person sees them | the OpenAPI document, the CLI's help and the reference pages: generated, English         |
| dates, numbers, lists and relative times, through `Intl`  | anything hand-formatted: a date or a number is never assembled from parts                |

### Per tenant

- The **supported-locales list and the default locale** are tenant settings,
  set through the admin API and the Branding area (P4b).
- **Message overrides** are a tenant's own text for a catalogue key in one
  locale: the shape is `{ locale, key, message }`, stored per tenant, bounded
  in count per tenant, and keyed by the same IDs. An override of a key that
  does not exist in `en` is refused. An override is untrusted input and takes
  the same escaping as any catalogue value.
- **Right-to-left is a rule of the page shell**, not a feature of one locale:
  the shell sets `dir`, and every stylesheet it carries uses logical properties.

### Security

- **A catalogue value is data, not markup.** Every value reaches HTML through
  the renderer's `escapeHtml`; a placeholder is typed (a number, a string, a
  date), never raw HTML. No message carries markup. If a message ever has to
  carry a link, a named safe-subset form is decided in its own ADR first.
- **A tenant override is untrusted** and is escaped exactly as a catalogue
  value is, whatever its length or characters.
- **A locale tag never reaches a file path, a `lang` attribute or a header
  unvalidated.** The catalogue is loaded at boot into a map keyed by the
  shipped tags; a request's tag selects a map entry and is never joined into a
  path.
- A catalogue's own keys are a build input. Nothing a request supplies adds
  one.

### Dimensions beyond translated text

Each row has an owner or a decision, and a reason one line long.

| #   | Dimension                                     | Today (checked)                                                                                                                                                                                                                                                                              | Owner and decision                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layout direction (`dir`, right-to-left)       | server pages carry no stylesheet at all, so there is nothing to convert; the console already uses logical properties in 122 declarations and has four physical sites (below), two breadcrumb glyphs and one arrow                                                                            | **P4g** builds the page shell logical from its first rule; **P4h** converts the console's physical sites and mirrors its directional glyphs; **P4b** ships one right-to-left locale so both are exercised                                                                                                                                                                 |
| 2   | Sort order of names and labels                | server search keys are lowercase generated columns `COLLATE "C"` (migrations `0073`–`0075`): binary order; one `ORDER BY roles.name` (`packages/domain-authz/src/repository/roles.ts:169`) uses the column's default collation                                                               | **Decision:** the server stays binary, because a keyset cursor needs a total order that one index serves (ADR 0041). **P4h:** the console orders a page it already holds with one shared `Intl.Collator` in the console's locale                                                                                                                                          |
| 3   | Localised client and scope metadata           | `clients.name` is `NOT NULL` text; `clients.description`, `client_scopes.description` and `consent_text` are single strings; the consent page cannot localise them                                                                                                                           | **P4b**: a per-locale map beside each base string (shape below), the admin API and a locale-tabbed editor in the Branding area                                                                                                                                                                                                                                            |
| 4   | Language-tagged claims, `claims_locales`      | profile claims are single-valued (`packages/contracts/src/admin/profile.ts`); `claims_locales` is ignored by decision                                                                                                                                                                        | **Decision:** Odudu emits no `given_name#ja-Kana-JP`-style claims, and `claims_locales` stays accepted and ignored, which OIDC Core §15.1 allows. It needs a per-locale profile attribute; **P7**'s declarative user profile is the place to revisit it, and nothing earlier needs it                                                                                     |
| 5   | Translated field validation errors            | `fieldErrorSchema` is `{ path, message }` (`packages/contracts/src/admin/shared.ts`): English prose, no code                                                                                                                                                                                 | **P4h**: `errors[]` gains an additive `code` and `params`, the console's catalogue translates them, and `detail` stays English for developers                                                                                                                                                                                                                             |
| 6   | Discovery and headers                         | `ui_locales_supported` and `claims_locales_supported` are absent from discovery (`packages/contracts/src/discovery.ts`); pages are `Cache-Control: no-store` (`packages/kernel/src/page.ts`)                                                                                                 | **P4g** adds `ui_locales_supported` (the shipped catalogue locales; P4b makes it the tenant's list), `Content-Language` through `pageHeaders`, and `lang` on a fallback span. `claims_locales_supported` stays omitted (row 4). No `Vary: Accept-Language`: a `no-store` page is never cached                                                                             |
| 7   | Unicode safety of user-controlled text        | `neutralise` replaces C0/C1 controls in identity fields (`apps/server/src/input-hygiene.ts`) and the login throttle key is NFKC (`apps/server/src/login-throttle.ts`); bidi controls, normalisation and confusables are untouched; `usernameSchema` is `z.string().min(1)`, compared exactly | **P4g** refuses bidi controls (U+202A–202E, U+2066–2069) in typed identity and name fields and isolates user text with `<bdi>` on its pages; **P4h** does the same display rule in the console; **P7** owns a confusable (UTS #39) policy for usernames, where identifiers arrive from outside                                                                            |
| 8   | Documentation site, landing page, `README.md` | English, and built in P4g                                                                                                                                                                                                                                                                    | **Decision:** not translated for 1.0, reason: a translation nobody maintains is worse than none. **P4g** keeps each page's source in one directory per language so a community translation adds a directory (verified: Rspress builds `content/en/` at the root and an added `content/fr/` under `/fr/`, with its own search index and a language switcher; P4g spike S3) |
| 9   | Languages beyond the first                    | one language                                                                                                                                                                                                                                                                                 | **Decision:** below                                                                                                                                                                                                                                                                                                                                                       |

**Row 1's physical sites**, from `grep` over `apps/admin-console/src` css:
`FilterBar.module.css:64` and `Toasts.module.css:27` use four-value `padding`
whose left and right differ; `Field.module.css:367` and `AppShell.module.css:207`
use `translateX`; `Breadcrumb.tsx` draws `›` and `‹`; `AuditDetail.tsx` writes
"before → after". Every other `margin`, `padding` and `inset` there is
symmetric or already logical.

**Row 3's shape.** A map of locale tag to string, `jsonb`, in a column beside
the base string (`name_i18n`, `description_i18n`, `consent_text_i18n`),
`'{}'` by default. The base column stays the value for a locale with no entry
and for every API that predates the map. A map beats a translations table
because a list or a consent page reads the row it already has: a table adds a
join or a second query per page, and ADR 0041 holds a list to a constant number
of queries. The map is bounded by the tenant's supported-locales list and a
cap on its length; each key passes `isValidLocale` and each value its base
column's length limit. On the wire, Dynamic Client Registration carries it
as `client_name#fr` (OpenID Connect Registration §2.1; RFC 7591 §2.2).

**Row 9, the policy for another language.**

- The fallback chain is RFC 4647 lookup, then `en`: `zh-Hant-TW`, `zh-Hant`,
  `zh`, `en`; and per key, so a locale that lacks one message shows that one
  in `en` and the rest in its own language.
- A locale ships in Odudu's catalogues when it is complete for the user-facing
  pages (the keys of every `*-html.ts` and the mail templates); anything less
  is a tenant override or a fallback, not a shipped locale.
- A translation is a pull request changing catalogue files, reviewed like
  code. A translation tool (Weblate, Crowdin) is optional and out of scope.
- A lint failing when a key is in `en` and missing from a shipped locale is
  not required for 1.0, because the per-key fallback already makes a gap
  harmless.
- "Every locale" is not a goal. The architecture lets a tenant, or a community
  contribution, add one without a code change.

### Where the work lands

| Phase   | Owns                                                                                                                                                                                                                                                                                              | Why there                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **P4g** | English catalogues for every server page and mail template; the negotiation function; `<html lang>`, `dir` and `Content-Language`; `ui_locales_supported`; the page shell logical-only and `<bdi>`; the bidi-control refusal; the new-code lint (below); documentation site laid out per language | it rewrites every renderer for Instrument anyway, so extracting the text is one touch, not two                              |
| **P4f** | its new pages written against the catalogue                                                                                                                                                                                                                                                       | they are written after P4g, so they have no English to extract later                                                        |
| **P4b** | the tenant's locale list, default and message overrides in the Branding area; localised client and scope metadata; one shipped non-English right-to-left locale proving the path                                                                                                                  | the Branding area is where a tenant already edits its pages' look, and a right-to-left locale is what tests the layout rule |
| **P4h** | every console string from a catalogue, ICU plurals, a locale switch, a pseudo-locale test, logical CSS and mirrored glyphs, `Intl.Collator` ordering, `errors[].code`, the bidi display rule in the console                                                                                       | the console is a separate bundle with its own catalogue, and its wording was only just consolidated into `service`          |
| **P7**  | a confusable policy for usernames; revisiting language-tagged claims                                                                                                                                                                                                                              | identifiers arrive from outside here; per-locale attributes need the declarative profile                                    |

### A rule for new code, from the day this is accepted

**A user-facing string in a server `view` layer or in a console `service` is
written as an entry in one flat record keyed by a stable ID, and read from
it.** In the server that is a `messages.ts` beside the renderer; in the console,
the wording constants `service` already holds. Wording with a count keeps the
existing `counted()` and `plural()` (`apps/admin-console/src/shared/service/format.ts`),
the two calls extraction replaces, rather than inventing a third shape. A
string built inline in markup or a hook, with no record, is what a later
extraction cannot find mechanically.

**Nothing enforces this today.** The console's `service` constants already
follow it (212 upper-case `export const` constants, not all of them wording, and
21 `counted` or `plural` call sites outside `format.ts`, by grep); the server renderers do not, and the 1,035 lines
of the fifteen `*-html.ts` files hold their text inline. The lint that fails
on a user-facing literal outside a record is **P4g's**, for the server, and
**P4h's**, for the console, with the extraction each lint follows.

## Consequences

- Every page, mail and console screen has one place its text lives, so a
  translation never touches logic.
- The negotiation order has a security property written into it: a language
  that depends on who is typing does not appear before they have proved it.
- P4g, P4b and P4f grow, and a new phase, P4h, exists. §11's table carries the
  hours and the reasoning.
- The per-locale map for client metadata costs a column per base string and a
  length cap, and it is not a general translation store: a field this
  ADR does not name stays a single string until it is named.
- Dates, numbers and relative times through `Intl` follow the runtime's locale
  data, so two Node versions can print a date differently; the pages that show
  one say which locale they negotiated.
- The console's `plural()` stays English-only until P4h replaces it, and no new
  code is written to depend on it for a language that is not one-or-other.

## Alternatives rejected

- **`gettext` `.po` catalogues.** Plurals are by number only, with no select
  and no nested arms, and a message's identity is its English text, so
  rewording `en` orphans every translation.
- **One central catalogue for the whole server.** It makes every package depend
  on one file, and ADR 0010's layering has no place for it.
- **Text in the database, edited through the admin API.** Catalogues are code
  review's work and ship with a release; only a tenant's overrides are data.
- **Translating `error_description` and a problem's `detail`.** Both are for a
  developer reading a log; a client that branches on prose is broken whatever
  language it is in.
- **The subject's locale before authentication.** It leaks whether an account
  exists, as above.
- **A translations table for client metadata.** One more query per consent
  page, against ADR 0041.
- **Locale-aware collation in the server.** It needs an index per collation and
  a cursor per locale; the console can order a bounded page it already holds.
- **Emitting language-tagged claims now.** It needs per-locale profile attributes
  this model does not have, for a parameter OIDC Core lets a server ignore.
- **Hand-formatted dates and numbers.** They are right in the author's locale
  and wrong in the next.
- **Enforcing the new-code rule by a lint today.** There is nothing to
  enforce it against until the extraction exists; a lint that every file
  fails on teaches people to ignore lints.
