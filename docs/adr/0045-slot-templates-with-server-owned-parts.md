# 0045 — A page template is HTML with slots; the server owns every part that does something

**Status:** Accepted · 2026-10-27

## Context

A tenant or client may replace the markup of the pages the sign-in flow shows.
A page carries a form, hidden fields, a CSRF value, a nonce'd script on one
page and the wording of a locale, and a template written by a tenant must not
be able to remove, duplicate or forge any of them, nor to run script on the
authorization server's origin.

## Decision

A template is HTML with two kinds of slot and no other syntax: `{{part.name}}`
and `{{t "catalogue.key"}}`. Each page kind declares a manifest of parts
(`PAGE_KINDS` in `@odudu/kernel`): the form's open and close tags, the fields,
the submit, errors, links, and `script` where the page needs one. The server
builds every part; the template only places them. Catalogue text is escaped
on insertion and parts are inserted as built.

`checkTemplate` runs when a draft is saved and again at publish. It parses with
parse5 and accepts only what it recognises: an allowlist of elements, of
attributes (`class`, `lang`, `dir`, `role`, `aria-*`, an https `a href` with
`rel="noopener noreferrer"`, an `img src` that is one of the theme's assets
with `alt`), each required part exactly once, no unknown slot, no slot in an
attribute, comment or raw-text element, no comment, and bounds on size
(64 KiB) and slot count (200). The source is what is filled, so a tag the
parser would drop in context is refused by name too. A template that fails
any check at render time falls back to the layer below.

## Consequences

- A theme cannot reach a form, a field or a script, so it cannot exfiltrate a
  password or drop the CSRF value; the manifest check makes a template that
  loses the form fail at save rather than render a page nobody can submit.
- A new element or attribute is a change to the allowlist, never a default.
- Layout control is real (any arrangement of the parts) but there is no
  conditional or repeated markup; a part that varies by step (`fields`) is one
  slot.

- **A theme is resolved once per scope and kept, bounded.** A render reads the
  published tenant and client rows and their images in one statement on a miss
  and in none on a hit. The cache is an LRU of at most 5,000 entries and 32 MiB
  of template text, each entry gone after 30 seconds (ADR 0041's 10,000 tenants
  with 10,000 clients each cannot grow it), and a scope with no theme is an
  entry too, so a tenant on the default look costs no query per render. The key
  is the tenant and client, not the version: a render learns the version only by
  reading, so an entry stands until a publish, restore or reset in this process
  drops it or its 30 seconds end. A replica that did not take the publish shows
  the previous version for at most those 30 seconds, and shared invalidation
  belongs to P11. Concurrent misses for one scope share one read, with at most
  256 reads in flight. `checkTemplate` and the stylesheet check run once at
  fill, so a template saved before a manifest tightened falls back to the layer
  below, or the default, and is logged once per tenant, client and version.

- A logout page wears a client's theme only for a client an `id_token_hint`
  verified for (and that is a registered, enabled client of the tenant).
  `client_id` on a logout request is a parameter anyone can write, so it never
  chooses a theme, and the confirmation POST wears the client only when the
  form's token was minted under a purpose that records the first contact
  verified it: a `client_id` the form merely carries gives the tenant theme.
  "Verified" means signature, issuer and a registered, enabled client of this
  tenant; the hint's `exp` and `sid` are deliberately not judged (RP-Initiated
  Logout allows expired hints), so any ID token ever issued to a client can make
  that client's own theme appear. That selects only a theme the tenant's admin
  published for that client and grants nothing else.
  It costs no query beyond the theme read the page already makes.

- `form.open` carries every hidden field the form posts, the proof included,
  so no page needs a part for them and a template cannot drop one. Parts are
  guaranteed present, in order and inside the form's pair, not that the
  template's own wrapping markup keeps them usable: a tenant that wraps
  `form.open` in a link breaks its own page, which is accepted.

## Alternatives rejected

- **A structured theme** (fixed layouts, a few knobs): the safest and the
  simplest to check, and too little control for a tenant that wants its own
  page. Rejected.
- **A logic template language** (Liquid-style conditionals and loops):
  decided against for now. It needs a sandboxed engine with execution limits
  and a larger attack surface, for control nobody has asked for. Slot
  templates grow into it without redoing the sanitiser or the required-parts
  check, because those run on the filled-in structure either way. Revisit
  when a user asks for it.
