# Optional username at registration: design

Status: proposed, 2026-11-17. A small increment after P4f, not a phase.

## Intent

A tenant that signs people in by email should not have to ask them to invent
a username. Today the registration form always asks for both, `users.username`
is `NOT NULL`, and no setting says otherwise. The owner asked for the choice
per tenant, with email staying required.

## Goals

- A tenant setting `registration_username`: `required` (default, today's
  behaviour) or `generated`.
- With `generated`, the registration form has no Username field and the server
  assigns an opaque handle. Everything that reads `users.username` is unchanged.
- The console shows the setting under Registration, and says what it needs.

## Non-goals

- A nullable `users.username` (touches the unique index, claims, search, the
  me API and the MCP tools).
- Optional email at registration, and any change to admin-created subjects,
  which keep a required username.
- Changing existing users: only registrations made after the setting changes
  follow it.

## Decisions

1. **Setting.** `registration_username` is a text setting with the values
   `required` and `generated`, default `required`, added to `tenants` by a
   migration, to the settings map and contract, the tenant document (absent in
   an older export imports as `required`), the console and the docs.
2. **Generated value.** An opaque handle, never derived from the address:
   `u-` plus 10 lowercase base32 characters from a cryptographic random source
   (50 bits). A collision is retried a few times on the unique constraint
   before the registration fails as it does for any unexpected error.
   Rationale: the address would otherwise reach `preferred_username`, which
   relying parties must not treat as an identifier.
3. **Dependencies.** `generated` is refused unless `login_with_email` and
   `verify_email` are both on, because sign-in by email accepts only a
   verified address (`byVerifiedEmail`) and a person with no username has no
   other way in. The refusal is enforced where settings are written (admin
   PATCH, MCP is not a writer of it, tenant import) and the reverse holds:
   turning either dependency off while `generated` is on is refused. The
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
- B (chosen): a setting and a generated handle. Smallest change that keeps
  every consumer of `users.username` working.
- C: nullable username. Rejected: widest blast radius, and the products
  compared keep an internal username even in email mode.

## MCP and the me API

- `get_settings` returns the tenant settings document, so the field appears
  there once the contract has it; no new tool.
- Writing it through MCP is withheld like every other setting outside
  `display_name`, `supported_locales` and `default_locale` (class W2, P5b):
  add it to the W2 list in `docs/protocols/mcp-route-classes.md` and to the
  refused names in `packages/mcp/src/service/tools/settings-write.test.ts`.
- The me API is unaffected: it reads and amends an existing person, and
  registration is not one of its routes.

## Scale

A registration adds no query and one random draw. The setting is read with
the tenant row the registration already reads.

## Left to the builder

The column and contract names beyond the setting's wire name, the handle
alphabet helper's location (a pure `service` function), and the exact wording
of the console note and the refusal message.

## Verified in this repository (grep before the plan relies on it)

- Sign-in by address uses `byVerifiedEmail`: `packages/authn-flows/src/usecase/executor.ts:83`.
- The form's fields are one `fields` slot of the templated `registration` page:
  `packages/account/src/view/registration-html.ts:145`.
- A comparable setting's footprint: `login_with_email` in
  `packages/db/drizzle/0083_login_with_email.sql`, `packages/db/src/schema/tenants.ts`,
  `packages/domain-tenant/src/service/tenant-settings.ts`,
  `packages/contracts/src/admin/{docs,tenant-document}.ts`,
  `apps/admin-console/src/pages/settings/services/accessSections.ts`,
  `apps/docs/content/en/admin-console/settings.mdx`.
