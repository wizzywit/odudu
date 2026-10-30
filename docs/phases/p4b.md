# P4b — theming and client branding

What the phase found while building it, in the shape `docs/phases/p4g.md`
follows. The phase's argument is in
[its design](../archive/specs/2026-10-27-p4b-theming-and-client-branding-design.md)
and [its plan](../archive/plans/2026-10-27-p4b-theming-and-client-branding.md).

Started 2026-10-27.

## Placement

The custom domain per tenant left P4b for a new phase, P4j, straight after it
(design section 3). P4j's 20–35 h is an estimate to refine in P4j's own
brainstorm. Liquid-style template logic went to the roadmap's "Decided against",
to be revisited when a user asks for it. P4b's own hours (81–134 h) are
unchanged; they were not tracked, so the range stays an estimate.

## The logout form's fields were outside its token

The confirmation form carried `client_id`, `post_logout_redirect_uri` and
`state` as hidden fields that the `csrf` value did not cover, so a form edited
after it was issued still verified. `SessionEntry.proof` now takes the bound
values, each length-prefixed, and the confirmation passes all three on issue and
verify. A caller that posts back only some of the fields now fails: the
plan-drive for the end-session path did, and was changed to post every hidden
field, and so did the front-channel transcript's request, which omitted
`client_id`. The decision is ADR 0047.

## The per-client opt-out of the logout confirmation

`clients.skip_logout_confirmation` (migration 0106) is off by default and on for
every built-in admin client, which is the console's: the migration sets it
`WHERE builtin_admin`, and `provisionAdminClient` creates the client with it on.
That client is guarded on the admin API like every field outside
`BUILTIN_ADMIN_AMENDABLE_FIELDS`, so nobody can turn it off.

- **Decision shape.** `decideLogout` takes `{ session, hint, client, redirect }`.
  `session` is `{ id } | null` rather than a boolean, because the rule compares
  the hint's `sid` with the live session's id and a boolean cannot carry it.
  `ValidHint` is built from a hint that verified and names exactly one audience
  and a `sid`; a hint with several audiences is no hint for this purpose.
- **One path ends a session.** The confirmation `POST` and a skipping first
  contact both call `endAndAnswer`, so the redirect rule, the frames, the
  back-channel enqueue and the cleared cookies are the same code. `handleLogoutRequest`
  therefore takes the request context an end needs for its audit row.
- **Statements.** The flag rides on the `clients` row the route already read, so
  the cost of a logout that asks did not change. Asking about a hint is five data
  statements (the tenant row, the browser's sessions, the signing keys the hint is
  verified against, the client row and its redirect list); with no hint the keys are
  not read, so four. A skip that ends adds the end's seven (session update, audit
  event-type read, audit insert, grant revoke, back-channel client read, signing-key
  read for the logout token, delivery insert) and one front-channel client read:
  thirteen. `logout.int.test.ts` asserts five, four and thirteen through the driver's
  query hook. `pnpm test:plans` still passes, but its end-session drive posts the
  confirmation form and does not reach a skip, so the plan check does not cover
  the skipping path; no new index is needed, since no new predicate is read.
- **Expired hints skip too.** Every logout hint is read with `exp` unjudged (the spec
  accepts an expired hint to identify a session), and the skip reuses that reading, so
  a lapsed ID token for a live session of a skipping client still signs it out. The
  console's own ID tokens last five minutes and its sign-out can come later, which is
  why `exp` is not required. ADR 0047 records this, and the warning beside the setting
  names expired tokens.
- **Dynamic Client Registration** refuses the member by name
  (`invalid_client_metadata`) rather than dropping it. There is no registration
  update path, so registration is the only door.
- **The tenant document carries it.** Export writes it and import reads it
  (`manage-tenants`, the broadest capability); a document exported before the
  setting existed has no member and imports with it off.
- **Import turns the flag on with count-level audit.** An import that sets
  `skip_logout_confirmation` on a client is audited as `tenant.import` with counts
  only, not as the per-field `client.create` diff the admin API writes, so the
  setting appearing through an import is visible in the new tenant's clients and
  not in its trail.

## Localised client and scope metadata

- **Migration `0109_i18n_metadata.sql`** adds `clients.name_i18n` and
  `description_i18n` and `client_scopes.description_i18n` and `consent_text_i18n`, each
  `jsonb NOT NULL DEFAULT '{}'`, with a CHECK for an object of at most 128 KiB. The
  application holds the rest: keys through `canonicalLocale`, each once, at most 32,
  each in the tenant's `supported_locales` on a write, each value at the base column's
  limit (client name 256, which the name column itself does not have; description 1000;
  consent text 500) and free of bidirectional controls.
- **Migration `0110_theme_version_unique.sql`** makes the database refuse a version number
  used twice in a theme scope (draft rows excluded); the per-scope lock already prevents it.
- **Import refuses an override naming an argument its page does not supply.** Message
  overrides exist only in this unreleased phase, so an override stored before that check
  (a development database) exports and is then refused on import, naming the key and the
  argument at `document.message_overrides[n].message`, until the file is corrected.
- **A PATCH replaces the whole map**, as it does a list field, and a PATCH naming a
  client's map must carry `If-Match` (428 otherwise). A scope's is optional, as every
  scope amendment's is. An empty object clears. A language dropped from the tenant's
  list later leaves its stored text alone; no page asks for it.
- **Lookup** is RFC 4647 §3.4 on the page's negotiated tag (`lookupLocalised`,
  `@odudu/contracts`), then the base column. The consent page and the sign-in page's
  client name use it. The text is the client's own metadata, as the base name is, and
  carries the same trust: it is escaped by `tHtml` and isolated in `<bdi>` like the base.
- **Dynamic registration** reads `client_name#<tag>` members: a well-formed tag the
  tenant does not offer is dropped and not echoed, a malformed tag, a tag written twice,
  a bad value or more than 32 members is refused as `invalid_client_metadata` without
  repeating the member's name. The 201 echoes what was kept.
- **The tenant document carries all four maps**, defaulting to empty, so an earlier
  document still imports; an import checks them against its own `supported_locales`.
- **Base bounds.** The base client name is now held to 256 characters on the write doors
  (registration, admin create and PATCH) and a scope's description to 1000 (create, PATCH).
  **Import does not bound them**: a legacy row the seed CLI wrote exports as it is, and an
  import that refused what an export emits could not restore its own tenant; the document's
  character checks (no bidirectional controls) still apply, and the per-language maps stay
  bounded on import. Export does not clip, so the round trip returns the value unchanged. A value already stored that is longer passes when sent back unchanged, as with
  bidirectional controls, so no old row blocks an unrelated edit. No CHECK was added: it would
  fail the migration on any existing long row and bound the seed CLI's names, and the
  application's write checks are where every other text limit of a client is held.
- **Only `client_name#<tag>` is read.** `client_uri#fr`, `logo_uri#fr`, `policy_uri#fr` and
  `tos_uri#fr` are ignored and not echoed (RFC 7591 §2.2 lets a server ignore them); the
  localised pages a client links are a later request if one is made.
- **A scope PATCH leaves `If-Match` optional**, as every scope amendment does: scopes have no
  list field that forces it, and the console always sends one. A client's maps require it
  because the client already requires it for its whole-replaced lists.
- **Row weight.** The four maps ride on the rows a client or scope read already selects: up to
  about 40 KB a client at the worst case (32 entries of 256 and 1000 characters), so a
  list of 200 clients can be several megabytes. A list read cannot leave them out cheaply,
  since the list item is the client's wire shape and the contract makes the maps required
  members of it; the plan volume holds full maps on every client and scope and the statement
  counts stay constant, but bytes per page grow. Dropping them from list items is a contract
  change left for whoever measures a need.
- **Attacker text.** An anonymous registration persists up to 32 x 256 characters of the
  registrant's text per client in `name_i18n`, the same exposure as the base name, bounded by
  `max_clients` and escaped wherever it is shown.
- **No extra query**: the maps are columns on rows already read, so a list read and the
  consent context make the statements they made before.

## Arabic

- **Drafted, unreviewed.** Every Arabic sentence of the five catalogues
  (`messages.ar.ts` in account, authn-flows, console-gateway and protocol-oidc, and
  `packages/email/src/service/messages.ar.ts`) was drafted in Modern Standard Arabic by the
  implementer, with no reader of Arabic. `SHIPPED_LOCALES` is `['en', 'ar']`; a tenant still
  offers a language only by listing it in `supported_locales`, which defaults to `en`.
- **Completeness is checked, quality is not.** `tests/lint/arabic-catalogues.test.ts` fails on a
  missing or extra key, on an argument whose name, kind or number skeleton differs from
  English, on a select with different arms, and on a plural without all six forms Arabic
  needs (`zero`, `one`, `two`, `few`, `many`, `other`). The one plural, `throttled.retryAfter`,
  has them all.
- **Counts avoid agreement.** Arabic number-noun agreement changes with the number, so a count
  of characters or rules reads "N من الأحرف" and "N من أصل M من القواعد", which is grammatical
  for every N. Digits are Latin: `Intl` formats `ar` with Latin digits, as the codes and
  keys on the same pages are.
- **Layout.** The page stylesheet already used only logical properties; the check is now a
  word search that refuses any `left` or `right`, `translateX`, `scaleX` and
  `background-position` (`packages/instrument/src/service/build.test.ts`). The two things
  it permits are named there: the 404 drawing's rotation, which is art and not mirrored,
  and `letter-spacing` on the Latin wordmark only, because spacing breaks the joining of
  Arabic letters. Mail clients do not read logical properties, so a right-to-left mail sets
  `dir="rtl"` and an explicit `text-align:right`, and keeps its Latin link `dir="ltr"`.
- **Isolation.** Every placeholder that can carry a client, account or label name is isolated
  in a `<bdi>` at its call site; the two passkey failure messages wrap `{reason}`, which the
  page script fills in with a browser message, in first-strong isolates (U+2068, U+2069) in
  the Arabic text. `arabic-isolation.test.ts` in each package holds this.
- **Browser proof.** `apps/admin-console/e2e/server-pages-arabic.spec.ts` reaches every kind of
  page with `Accept-Language: ar`, asserts `lang`, `dir` and the computed direction, and runs
  the same axe scan in both colour schemes, the phone width and the card width. It runs in CI.

## Themed mail

The logo is a hosted address, not an attachment (ADR 0046's amendment): a queued row
holds one URL where a CID image would hold up to 341 KiB. The brand route serves an image
only while a published version names it, so a mail queued before a publish that drops its
logo, and any such mail opened later, shows the alt text in the box its `width` and
`height` hold. `themed-mail.int.test.ts` pins this: it queues a mail, publishes a
replacement, sends, and then fetches both addresses.

A mail is themed in the transaction it is queued in. The resolver the pages use reads
through its own connection, which a burst of mail inside open transactions could starve,
so `resolveMailBranding` reads the tenant's layer through the caller's transaction and
fills the same cache the pages read. The reset request and the registration read the theme
and the tenant's default language before they look the address up, so a known address
and an unknown one cost the same (`branding-wiring.int.test.ts` asks for the theme on both paths).

A scheme whose palette fails the theme's contrast rules at build time is dropped for the
mail's own colours; the roles a mail draws (ink and muted on page, panel and sunken, the
link ink on all three, the button's ink on its fill) are all pairs the validator holds.

## Client-branded mail

A mail wears the client of the sign-in the flow began in (ADR 0046's second
amendment). No token or pending registration stores a client: both mails the
sign-in's pages queue (registration verification, reset request) are written in the
request that holds the sign-in, so the held sign-in's own `clientId` is handed to the mail
look under the condition the resume link already has (`clientOfHeldSignIn`). The mail
read is never served from the page cache, which cannot know that a client was disabled
since; it costs one statement, as the tenant's own cache miss does, and is made before
the address lookup. `client-branded-mail.int.test.ts` holds the forged, foreign, disabled
and deleted cases and the known-versus-unknown prefix of statements.

The preview is built too, as `GET /clients/:id/mail/preview` and `/mail/branding` beside the
client's theme routes (`manage-clients`, the same 404 for a foreign and a missing client; a
disabled client shows the tenant's look; the branding view's `source` gains `client`). The
Mail tab's `Preview as client` uses the shared client picker; the client's own Branding tab
has no Mail view, since the tenant's Mail tab previews every client. The client read costs
one savepoint-guarded statement per mail, paid before the mail gate and the address lookup
whether or not the address is known: `EXPLAIN (ANALYZE, BUFFERS)` of the client-bound
`forRender` on a scratch PostgreSQL (10,000 clients in one tenant, 2,000 tenants, a theme
each) was an Index Scan on `clients_client_id_unique` with a 0.2 ms execution; the scratch
database is gone and CI's `query-plans` verifies the shipped statements.

## An undeclared upload type got Fastify's own 415

Found while capturing the transcripts: `POST /theme/assets` with `Content-Type:
image/svg+xml`, or with none, answered the generic framework refusal (`about:blank`,
title `FastifyError`) rather than `about:blank#asset-unsupported-type`. The route's
scope keeps only its own content-type parsers, so Fastify refused the type itself before
any handler ran. A raw-body route may now carry `unsupportedType`, and the router
refuses a declared type outside its list in the same `onRequest` step that
authenticates and checks the size, so the body is still never read. The theme page's
upload section shows the new answer for a declared type and for none.

The registration transcript for `client_name#fr` is its own page, [Registering a client
with names in other languages](../../apps/docs/content/en/reference/transcripts/request-paths/registering-a-client-with-names-in-other-languages.md),
because the bootstrap page it was owed on is a record of several earlier runs and a
section run later would have made it a claim about one more.

## What P4b shipped and what it found

Shipped by what a person can do: an administrator themes every page the server shows and the
mail it sends, a client overrides the tenant piece by piece, and a draft is previewed on the
real page, published as a version, restored or reset. Languages, wording overrides and Arabic
are tenant choices. Sign-out asks first. What the build found beyond the sections above:

- **The page-kind class was specified and never drawn.** `hooks.ts` said a themed page carries
  `page-<kind>` on its main part, and no renderer wrote it until the selectors list needed it.
  It is rendered now, and `page(...)` kinds are held to the kind beside them in `fillPage`.
- **The background image was a slot nobody drew.** `brandingCss` named it and emitted nothing;
  the page now draws it behind the panel.
- **The publication bar.** Section saves and image uploads did not hold the bar. Every theme
  write now does, Publish is always the whole draft from any tab, a tab can be reverted and
  the draft discarded, and publishing nothing is a 409.
- **Message overrides had no preconditions.** Two administrators on one key lost an edit
  silently. Each override now has an entity tag, `If-Match` on edit and delete and
  `If-None-Match: *` on create, answered `412` and `428`; the console shows its conflict panel.
- **The SMTP test mail was plain.** It took the tenant's wording and dropped the look. It now
  wears the tenant's theme, or a chosen client's, and is throttled, takes one address and
  never repeats relay text in its `502`.
- **A standards review found what the hardening fixed.** A stylesheet could hide the consent
  page's client name or remove the focus outline, and could shrink text to nothing; the brand
  route lacked a content-security policy and a resource policy; automatic mail lacked
  `Auto-Submitted`. A differential test of the template checker against a browser's parse
  found three ways a template could change what its slots build (a part between table parts,
  one inside a link, a form opening and closing in different cells). All are refused and held
  in [`docs/protocols/web-security.md`](../protocols/web-security.md). Its accepted rows are
  decisions (a template may link anywhere; a theme is the administrators' own words; two
  separate rules are not compared for contrast). Its one open row, the language of a client's base name, is P4h's.
- **Load order.** One Branding page load was six admin reads in a waterfall. `branding-load.spec.ts`
  records each tab's calls in the order they were sent and answered, and prints the waterfall.
- **Mobile.** The tabs were squeezed on a phone. A narrow screen now gets a preview strip, a
  full-width sheet that opens from it, and a publication bar folded to one row
  (`branding-narrow.spec.ts`).
- **The generated admin reference overran its table cap.** A section holding a request and a
  response together reached 71 rows, and the cap had been raised to 75 to fit. The generator
  now lists a body on pages of its own when the page would pass 60 rows, and the cap is 70 again.
- **The sign-in preview is the fullest sign-in.** Its sample shows the passkey button,
  the remember-me box and the links to create an account and reset a password whatever the tenant's
  settings, so a rule or template can be written against every part. The Branding page says so.
- **The undeclared upload type** and **the logout form's fields** are in their own sections above.

## Owed at phase close

Each belongs to the topic of another phase.

| Owed                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner | Why that phase                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| A reader of Arabic reviews every `messages.ar.ts` and a rendered page and mail of each kind, and fixes what they find. The text is a draft that is complete and unreviewed. No Arabic font is in the Instrument font stack, so rendering relies on the system fallback, which axe does not cover. Nits: `reset.reason` and the other mail `.reason` lines, `error.unknownTenant` saying `مستأجر`, `consent.allow` as the noun `سماح`. | P4g   | Its stable release: `RELEASING.md` makes the review step 3 before the stable tag. |

**Arabic review record** (`RELEASING.md`, step 3): nobody has read it yet.
| Tenant export and import carry no theme: the published tenant theme, each client's published theme and the uploaded images are not in the document, so a tenant imported under a new name starts with Odudu's look. Carrying them means a theme and an asset section in the document, base64 images within the 8 MiB cap, and an import that re-checks the bodies and writes a published version with new asset ids. | P7 | Its criterion already owns a tenant moved between installations; the roadmap, section 11 and `docs/NEXT.md` carry the line. |
