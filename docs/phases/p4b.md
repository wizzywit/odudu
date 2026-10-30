# P4b — theming and client branding

What the phase found while building it, in the shape `docs/phases/p4g.md`
follows. The phase's argument is in
[its design](../superpowers/specs/2026-10-27-p4b-theming-and-client-branding-design.md)
and [its plan](../superpowers/plans/2026-10-27-p4b-theming-and-client-branding.md).

Started 2026-10-27.

## Placement

The custom domain per tenant left P4b for a new phase, P4j, straight after it
(design section 3). P4j's 20–35 h is an estimate to refine in P4j's own
brainstorm. Liquid-style template logic went to the roadmap's "Decided against",
to be revisited when a user asks for it. P4b's own hours (81–134 h) are
unchanged and are set at the end of the phase from what the increments cost.

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
  why `exp` is not required. The spec's warning beside the setting names expired
  tokens, so the text and the behaviour agree; whether to require `exp` for the skip
  and exempt the console stays open for the owner.
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

## Owed at phase close

| Owed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner                 | Why not yet                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The console frame of the draft preview must be proven in a real browser: the shell's policy needs `frame-src 'self'`, and a frame sandboxed without `allow-same-origin` has an opaque origin, so whether `style-src 'self'` and `font-src 'self'` still load the Instrument stylesheet and fonts there is unproven; they may need CORS headers on `/instrument`. The preview is reached at `/console/api/admin/tenants/{tenant}/theme/preview`.                                                                                                                                                                                               | Task 23               | The Branding area does not exist yet; the route answers a frame today (`apps/server/tests/theme-preview.int.test.ts`), but no browser has framed it.                                                       |
| The preview's sign-in sample ignores the tenant's settings (remember me, passkey, registration and reset links), so it shows a fixed arrangement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Task 23               | The preview route takes no tenant settings; the console decides whether to pass them.                                                                                                                      |
| The admin router validates a body before it authenticates (the image upload is the exception: it authenticates and checks its size in `onRequest`, before the body is read), so an unauthenticated caller makes the server buffer and validate up to 4 MiB on a theme `PUT` (16 MiB on a tenant import) and reads schema details in a `400` where a `401` belongs (`packages/protocol-admin/src/view/routes/router.ts`). Proposed owner: P11, with the other load bounds.                                                                                                                                                                     | P11                   | Not placed in `docs/NEXT.md`: a placement there must have its roadmap line and section 11 criterion, and `tests/docs/roadmap-section-11.test.ts` fails without them; adding P11 scope is the owner's call. |
| The console names `Branding, Languages` as the home of `supported_locales` and `default_locale` (`PLACED_ELSEWHERE`), and `tests/lint/console-covers-admin-routes.test.ts` lists the three message override routes as pending; both entries go with the Languages tab, which fails the lint the moment a screen calls them.                                                                                                                                                                                                                                                                                                                   | Task 24               | The Languages tab is Task 24's.                                                                                                                                                                            |
| A reader of Arabic reviews every `messages.ar.ts` and a rendered page and mail of each kind, and fixes what they find, before any release. The text is a draft: nothing here says it is correct, only that it is complete. No Arabic font is in the Instrument font stack (`IBM Plex Sans`, then `system-ui`), so rendering relies on the system's fallback, which axe does not cover. Wording nits for the reader: `reset.reason` and the other mail `.reason` lines are awkward constructions; `error.unknownTenant` says `مستأجر` (a literal rendering of tenant); `consent.allow` is the noun `سماح` where an imperative may read better. | Project owner         | No reader of Arabic took part in the draft; `RELEASING.md` makes the review a step before every stable release.                                                                                            |
| Console screenshots of the Stylesheet section with a line marked, and of the Pages tab's code field, taken with `pnpm docs:screenshots` (the `branding` page still has no picture; `PICTURE_OWED`).                                                                                                                                                                                                                                                                                                                                                                                                                                           | Task 26               | Pictures need the live stack the transcripts are re-run on.                                                                                                                                                |
| Console screenshots of the Pages tab with the message picker open and of the preview notice (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The `GET /admin/openapi.json` transcript's `content-length`, path count and size are derived from the generated document after the background image and the preview bound changed it, beside the earlier capture's `Date`: re-capture it as the last transcript step, after every route change.                                                                                                                                                                                                                                                                                                                                               | Task 26               | Each route change moves the figures, so a capture taken before the last one is stale again.                                                                                                                |
| A console screenshot of the Images section with an uploaded image shown as a thumbnail (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The themed sign-in transcript (`GET /protocol/openid-connect/auth` on a stack with a published theme and a background image) should show the stylesheet it links now holding `body{background-image:url(...)}`, and the `img-src` that licenses the image; re-run it on a live stack with a background uploaded. Server-side the rule is emitted from the slot by `brandingCss`, before the tenant stylesheet.                                                                                                                                                                                                                                | Task 26               | The stack that captures these pages was not run with a background image.                                                                                                                                   |
| A captured transcript of `GET /theme/stylesheet-hooks`, re-run on a live stack; the admin-paths theme page holds prose only for it. The OpenAPI figures (103 paths, 660113 bytes, as `tests/docs/admin-paths.test.ts` derives them) were derived from the generated document, the path count and size edited by hand beside an old `Date` header, so `get-adminopenapijson.md` is not a capture until it is re-run.                                                                                                                                                                                                                           |
| A console screenshot of the Stylesheet section with the Selectors you can use list open and narrowed (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A captured transcript of `DELETE /theme/draft` (a draft saved, discarded on its ETag, the published theme and versions read back unchanged), of the theme read's `changed` field (a draft with two pieces differing, then none) and of the `409` `about:blank#theme-nothing-to-publish` that publishing an equal draft meets, re-run on a live stack; the admin-paths theme page holds prose only for them.                                                                                                                                                                                                                                   |
| The `GET /admin/openapi.json` capture does not yet include the two `DELETE .../theme/draft` paths, the `changed` field or the new `409` on publish: re-capture it after the last route change.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Console screenshots of the publication bar above the Theme and Pages tabs (the `Changed:` line and a tab's changed dot), of Revert this tab to published and of the Discard draft confirmation (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                |
| `apps/docs/scripts/openapi-pages.test.ts` caps a generated admin API page at 75 table rows, raised from 70 when the client theme save (request and response in one section) reached 71 with the `changed` field. A generator that splits a section over 70 rows into request and response pages is the clean fix, and the closing task or Task 26 decides it; until then the cap is a figure raised to fit.                                                                                                                                                                                                                                   |
| A captured transcript of `GET /theme/stylesheet-hooks`, re-run on a live stack; the admin-paths theme page holds prose only for it. The OpenAPI figures (99 paths, 632388 bytes) were derived from the generated document, the path count and size edited by hand beside an old `Date` header, so `get-adminopenapijson.md` is not a capture until it is re-run.                                                                                                                                                                                                                                                                              |
| A transcript of `GET /admin/tenants/{tenant}/mail/preview` on a stack where the tenant has overridden a mail key such as `verify.heading`, re-run on a live stack, with the override set by the `PUT /message-overrides/{locale}/{key}` shown beside it. The preview reads the overrides through the same read a queued mail does, so the page and the mail agree.                                                                                                                                                                                                                                                                            | Task 26               | The mail-wording increment changed the preview's text and no transcript shows it.                                                                                                                          |
| A transcript of the client mail routes (`GET /clients/:id/mail/preview` and `/mail/branding`), re-run on a live stack with a themed client, beside the tenant's (`get-mailpreview-and-get-mailbranding.md` holds prose only for them), and of a client-bound mail queued out of a sign-in. The OpenAPI figures (103 paths, 660113 bytes) were hand-edited.                                                                                                                                                                                                                                                                                    | Task 26               | The transcript needs a stack with a themed client.                                                                                                                                                         |
| A console screenshot of the Mail tab's `Preview as client` picker with a client chosen (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Task 26               | Screenshots are regenerated at the phase's close.                                                                                                                                                          |
| The concept page for branding (`concepts/branding.mdx`, held by another branch) says a message override changes pages only. It must say pages and mail, in the language each is shown in, and that mail wears the client's logo and colours when the flow began inside that client's sign-in, otherwise the tenant's (ADR 0046's amendment).                                                                                                                                                                                                                                                                                                  | Task 26               | The page is not on this branch's base, so the sentence could not be corrected where it lives.                                                                                                              |
| The `GET /message-catalogue` block, and the `400` block for an unknown key (the server now says `is not the key of any page or mail message`), of `get-message-overrides-put-message-overrides-and-delete-message-overrides.md` was captured before the mail section existed: it shows three sections and a message count without the mail's. Its prose now says four; the block has to be re-run on a live stack, not edited.                                                                                                                                                                                                                | Task 26               | The mail-wording increment changed the catalogue's answer; captured output is never hand-edited.                                                                                                           |
| A console screenshot of the Stylesheet section with the Selectors you can use list open and narrowed (the `branding` page still has no picture; `PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Any transcript or screenshot of a themed page shows its `<main>` as `class="page page-<kind>"` now (a themed page names its kind; an unthemed one is unchanged). The themed sign-in transcript is the one to re-run; no documented sentence says the class is never rendered.                                                                                                                                                                                                                                                                                                                                                                 | Task 26               | Transcripts are re-run on the live stack at close.                                                                                                                                                         |
| The theme-assets transcript's refusal for a declared type (`get-theme-put-theme-and-the-theme-routes.md`, the two `415`s with `the declared type is not image/png…`) is no longer the server's answer: the detail now reads `the declared type is text/plain, not image/png, …`, naming the type sent. Re-run both calls on a live stack. The generated OpenAPI figures move again with the stylesheet hooks `maxItems`/`maxLength` bounds.                                                                                                                                                                                                   | Task 26               | Captured output is not hand-edited, and a capture is taken as the last transcript step.                                                                                                                    |
| A console screenshot of the Stylesheet section now shows two pickers, Selectors you can use and Design values you can use, beside the editor (`PICTURE_OWED`), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Task 26               | Pictures need the live stack the transcripts are re-run on.                                                                                                                                                |
| A transcript of `POST /smtp/test` with `client_id` (a themed client's test mail, the `404` for a client the tenant does not hold, the `403` without `manage-clients`), re-run on a live stack. The OpenAPI size in `get-adminopenapijson.md` (now 662578 bytes after the message override preconditions) was derived from the generated document and edited by hand again.                                                                                                                                                                                                                                                                    | Task 26               | The transcript needs a stack with a themed client and a relay.                                                                                                                                             |
| A console screenshot of the Email area's **Send as client** choice with the console's own client preselected (`PICTURE_OWED`; `tour.mdx` and the `email` page picture show the old panel), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                | Task 26               | The screenshot needs a stack with a themed client.                                                                                                                                                         |
| A transcript of `POST /smtp/test` with a refused recipient (`400`), the `429` past the origin's budget and a `502` with its fixed sentence, re-run on a live stack with a relay that refuses; the prose of `get-smtp-put-smtp-delete-smtp-and-post-smtptest.md` was corrected without a re-run.                                                                                                                                                                                                                                                                                                                                               | Task 26               | The `502` needs a relay that answers.                                                                                                                                                                      |
| The message overrides transcript (`get-message-overrides-put-message-overrides-and-delete-message-overrides.md`) re-run on a live stack with `If-None-Match: *` on the create and `If-Match` on the change and the removal, showing the `428`, the stale `412`, the create-exists `412` and the `ETag` header; its captured commands predate the preconditions (the page says so). The OpenAPI figures in `get-adminopenapijson.md` follow the changed descriptions and the new `etag` field.                                                                                                                                                 | Transcript re-capture | Transcripts are re-run together on one live stack.                                                                                                                                                         |
| The tenant import transcript (`post-admintenant-imports.md`) re-run on a live stack: its setup `PUT /message-overrides/en/login.title` now carries `If-None-Match: *` (without it the server answers `428`, hidden by `-o /dev/null`), and the captured export and import outputs were taken before that precondition existed.                                                                                                                                                                                                                                                                                                                | Transcript re-capture | Transcripts are re-run together on one live stack.                                                                                                                                                         |
| Console screenshots of the Languages tab with a conflict panel on an override row's save, and of the publication bar's Revert with the same panel (`PICTURE_OWED`; `branding.mdx` describes both without a picture), taken with `pnpm docs:screenshots`.                                                                                                                                                                                                                                                                                                                                                                                      | Task 26               | Screenshots are regenerated at the phase's close.                                                                                                                                                          |
