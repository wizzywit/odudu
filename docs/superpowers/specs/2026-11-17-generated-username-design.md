# Optional username at registration: design

Status: proposed, 2026-11-17, revised after the owner's review. A small
increment after P4f, not a phase.

## Intent

A tenant that signs people in by email should not have to ask them to invent
a username. Today the registration form always asks for both, `users.username`
is `NOT NULL`, and no setting says otherwise. The owner asked for the choice
per tenant, with email staying required, and for the form to say which fields
are required and which are not.

## Goals

- A tenant setting `registration_username` with three values: `required`
  (default, today's behaviour), `optional` and `generated`.
- A registration form that follows the setting and marks every field required
  or optional.
- Everything that reads `users.username` is unchanged: a person with no chosen
  username gets an assigned handle.
- The console shows the setting under Registration and says what it needs.
- The MCP write of the setting is recorded where the phase that builds MCP
  writes (P5b) takes its work from, and a test fails if it is dropped.

## Non-goals

- A nullable `users.username` (touches the unique index, claims, search, the
  me API and the MCP tools).
- Optional email at registration, and any change to admin-created subjects,
  which keep a required username.
- Changing existing users: only registrations made after the setting changes
  follow it.

## The registration form

The form is one page, `renderRegistrationForm`
(`packages/account/src/view/registration-html.ts`), whose `fields` slot holds
the inputs. What each value of the setting does to it:

| Value       | Username field                                   | On submit                                                      |
| ----------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `required`  | shown, required                                  | as today                                                       |
| `optional`  | shown, labelled optional                         | a username typed is checked as today; a blank one is generated |
| `generated` | not rendered, and a posted `username` is ignored | the server assigns the handle                                  |

Required and optional are marked on every field, in the words the repository
already uses on the update-profile page (`Label (required)`, messages key
`updateProfile.required` in `packages/authn-flows/src/view/messages.ts`):

- each label ends with `(required)` or `(optional)`, from two message entries
  in `packages/account/src/view/messages.ts` with Arabic counterparts;
- each required input also carries the `required` attribute, so a browser
  refuses an empty one before the request, and the server still validates;
- in the default `required` mode that means Username, Email, Password and
  Confirm password each read `(required)`. Nothing is optional, so the page
  changes by the marker only.

A tenant's custom template keeps working: the markers and the `required`
attributes are part of the `fields` value the renderer returns. The screenshots
of the server pages on the landing page are regenerated with `page-shots`.

## Decisions

1. **Setting.** `registration_username` is a text setting with the values
   `required`, `optional` and `generated`, default `required`, added to
   `tenants` by a migration, to the settings map and contract, the tenant
   document (absent in an older export imports as `required`), the console and
   the docs.
2. **Generated value.** An opaque handle, never derived from the address: `u-`
   plus 10 lowercase base32 characters from a cryptographic random source (50
   bits). A collision is retried a few times on the unique constraint before the
   registration fails as it does for any unexpected error. The address would
   otherwise reach `preferred_username`, which relying parties must not treat as
   an identifier.
3. **Dependencies.** `optional` and `generated` are refused unless
   `login_with_email` and `verify_email` are both on, because sign-in by email
   accepts only a verified address (`byVerifiedEmail`) and a person with no
   chosen username has no other way in. The refusal is enforced where settings
   are written (admin PATCH and tenant import), and the reverse holds: turning
   either dependency off while the setting is not `required` is refused. The
   console shows the requirement beside the setting.
4. **Where the handle is assigned.** At submission, before the pending row is
   written, so a pending registration and the account made from it carry the
   same username.
5. **Email stays required** on the form and in the use case.
6. **Rename.** A generated handle is renamed only where `username_editable`
   allows, like any username.

## Approaches considered

- A: leave the form as is. Rejected by the owner: email-first tenants make
  people invent a handle.
- B (chosen): a three-value setting and a generated handle. Smallest change that
  keeps every consumer of `users.username` working. `optional` is the middle
  value the owner asked for (a username that is not required).
- C: nullable username. Rejected: widest blast radius, and the products compared
  keep an internal username even in email mode.

## The me API

The me API is the signed-in person's own API (`/me/profile`, credentials,
sessions, consents). It acts on an account that already exists, and
registration is not one of its routes, so it never reads this setting. The
setting decides only what a new account's username is when it is created. What
the me API shows afterwards is the same `username` field it shows for anyone,
now holding a handle for a person who did not choose one, and its rename rule
is unchanged (`PATCH /me/profile` accepts `username` only where
`username_editable` is on). No contract or route of the me API changes in this
increment.

## MCP

- Reading: `get_settings` returns the tenant settings document, so the field
  appears once the contract has it. No new tool.
- Writing: withheld like every setting outside `display_name`,
  `supported_locales` and `default_locale` (class W2, built in P5b).
  `registration_username` is identity-creating, so it is W2 with the other
  registration settings.
- Not to be missed by P5b, three records and one test:
  1. `docs/protocols/mcp-route-classes.md`, the work list P5b is built from:
     `registration_username` is named in the `PATCH ~/settings` row's W2 cell.
  2. `apps/docs/content/en/roadmap.md` (the P5b bullet) and the P5b row of
     section 11 of the umbrella spec: the words `registration_username` are
     added to the access-changing settings they list, so
     `tests/docs/roadmap-section-11.test.ts` maps them.
  3. `packages/mcp/src/service/tools/settings-write.test.ts`: the name joins the
     refused list. The server's walk of every setting name
     (`apps/server/tests/mcp-write-wording.int.test.ts`) refuses it with no
     change, which pins that it is not writable until P5b.
  4. A test in `tests/docs/mcp-route-classes.test.ts` fails if
     `registration_username` is missing from that W2 cell, so the entry cannot
     be dropped before P5b reads it.

## Scale

A registration adds no query and one random draw. The setting is read with the
tenant row the registration already reads.

## Documentation this increment owns

The registration guide and concept page that describe the form, the Registration
section of `admin-console/settings.mdx`, the generated settings reference, the
transcript of the registration routes re-run on a live stack, the landing page
server-page screenshots (`page-shots`) and `CHANGELOG.md` under `Unreleased`.

## Left to the builder

The column and contract names beyond the setting's wire name, where the pure
handle generator lives (a `service` function), and the exact wording of the
console note, the two markers and the refusal message.

## Verified in this repository

- Sign-in by address uses `byVerifiedEmail`: `packages/authn-flows/src/usecase/executor.ts:83`.
- The form's fields are one `fields` slot of the templated `registration` page:
  `packages/account/src/view/registration-html.ts:145`.
- The required marker precedent: `updateProfile.required` and its test
  `update-profile-html.test.ts:49`.
- P5b's work list is `docs/protocols/mcp-route-classes.md` (section 11, P5b row).
- A comparable setting's footprint: `login_with_email` in
  `packages/db/drizzle/0083_login_with_email.sql`, `packages/db/src/schema/tenants.ts`,
  `packages/domain-tenant/src/service/tenant-settings.ts`,
  `packages/contracts/src/admin/{docs,tenant-document}.ts`,
  `apps/admin-console/src/pages/settings/services/accessSections.ts`,
  `apps/docs/content/en/admin-console/settings.mdx`.
