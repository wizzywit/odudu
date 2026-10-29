# 0046 — Theme images are re-encoded raster files kept in PostgreSQL

**Status:** Accepted · 2026-10-28

## Context

A tenant or client may upload a logo, a favicon and a background for its
pages. An upload is a file chosen by someone who may be hostile: it can declare
a type it is not, carry a script after its last byte or in a metadata tag,
claim dimensions that decode into gigabytes, or be an animation or an SVG,
which can carry script and external references. The server holds up to
10,000 tenants (ADR 0041), so what it stores and decodes has to be bounded.

## Decision

- **Raster only.** PNG, JPEG and WebP. The type is read from the file's leading
  bytes; the declared content type and the filename are never consulted and
  never logged. SVG, GIF, TIFF, HEIF, an APNG (an `acTL` chunk before the first
  `IDAT`) and an animated WebP are refused.
- **Decoded and re-encoded.** `inspectImage` (sharp) reads the header first and refuses a declared size over 16 million
  pixels or a side over the kind's limit before decoding anything, then decodes
  with the same pixel limit, applies the EXIF orientation and encodes again.
  The stored file is the encoder's output, so metadata (EXIF, XMP, ICC, text
  chunks) and any bytes after the image are gone. Refusals are values with
  stable codes; a library error message is never passed on.
- **Limits** (`ASSET_LIMITS`): logo, dark logo and favicon at most 256 KiB and
  1024 px on the longest side, background at most 1 MiB and 2560 px, a tenant at
  most 8 MiB in all. The byte limit is on the upload and is checked before it is
  decoded. The re-encoded file may be up to 1.25 times that limit
  (`OUTPUT_GROWTH`), so a file under its limit is not refused because the
  encoder made it a little larger; past that the refusal is `too_large` too. The
  tenant cap counts the stored, re-encoded bytes. `inspectImage` has no byte
  limit of its own: callers go through `uploadAsset`.
- **Pixels.** 16 million decoded pixels (`MAX_DECODED_PIXELS`) is a backstop:
  every kind's side limit binds first (2560 px is at most 6.6 million pixels, about
  26 MB as RGBA), and it only matters to a caller that asks for a larger side.
- **Bounded work.** At most two decodes run at once and sixteen more wait; the
  next is refused as `busy`, so a hundred simultaneous uploads hold two decoded
  images and sixteen request bodies. A decode has sharp's own
  `timeout` of ten seconds on the encode pipeline (it does not apply to the
  header read, which sharp does not time, and which the upload's size bounds),
  and the inspector's deadline of twelve seconds (`DECODE_TIMEOUT_SECONDS`
  times 1,000 plus 2,000 ms) frees the slot and refuses as `timeout`. The
  deadline does not stop the libvips work: that is bounded by sharp's timeout
  and by the pixel and side limits, so a stuck call cannot hold both slots but
  can keep a thread busy until sharp gives up. libvips's
  operation cache is off.
- **Kept in PostgreSQL**, in `theme_assets` with the bytes in a `bytea` column,
  never selected by a list or a page render, addressed by the SHA-256 of the
  stored bytes with one row per tenant and hash. The tenant cap is checked
  under a per-tenant advisory lock, so two uploads cannot both take the last
  room. Row-level security keeps a tenant's images its own.
- **Served by hash, to anyone, from the database alone.**
  `GET /tenants/:tenant/brand/<sha256>.<png|jpg|webp>` answers while a
  published version of that tenant names the image, under the stored type, with
  `Cache-Control: public, max-age=31536000, immutable`, `nosniff`, an `ETag`
  of the hash and no cookie. A draft's image, another tenant's hash, an
  archived version's, a deleted one, a wrong extension and an unknown tenant
  all answer the same bare `404` (`no-store`); a name that is not 64 lowercase
  hex and an extension costs no read. The hashed stylesheet is not stored: its
  URL (`/brand/<sha256>.css`, or `/brand/c/<client row id>/<sha256>.css` when a
  client's theme is one of its layers) names the layers it is made from, the
  route reads them again through the resolver's own build and serves the
  result only if it hashes to the URL. No process memory is involved, so any
  replica answers for a page another rendered. The build is remembered in a
  bounded memo (at most 1,000 entries and 16 MiB of css, least recently used
  out) keyed by tenant, tenant name and the published version ids, which one
  small identity read supplies without any body; a hash that is not the
  remembered one answers `404` with no parse, concurrent first requests share
  one build, and a publish changes the key so the old entry only ages out.
  A client segment that resolves to no layer (none published, or another
  tenant's client) is a `404`, so the tenant-form URL has no aliases. The
  client row id in that URL is an internal primary key: random, not guessable,
  not a secret, and exposed only for a client with a published theme. A
  conditional request is answered from metadata, without reading the bytes.
  Every invalid shape under `/brand/`, a segment over the router's length
  limit included, is the same bare `404`. After a publish the previous
  hash no longer matches and answers `404`: a page another replica rendered
  from its cache in the last 30 seconds shows no theme until its next
  render. Per request the work is a tenant lookup and one indexed read; no
  bytes are cached in process, HTTP caching and any CDN do that.
- **The store is a seam.** Everything reaches images through `assetRepository`
  (`put`, `get`, `getPublished`, `referencedBy`, `delete`, `bytesUsed`); moving the bytes to
  object storage later changes that module and a migration, not the upload, the
  resolver or the console.

## Consequences

- The worst case is 8 MiB for each of 10,000 tenants, about 80 GB, in one table
  with its own TOAST storage. It is backed up and restored with the rest of the
  database and deleted with its tenant by the foreign key, and no deployment
  needs a second system to run a themed server.
- The server depends on a native library. sharp ships prebuilt binaries for
  glibc and musl on x64 and arm64 with no install script, so the image builds
  without a compiler. libvips inside it is LGPL-3.0-or-later, listed in
  `THIRD-PARTY-NOTICES.md`.
- Re-encoding changes the bytes and slightly the pixels of a JPEG or WebP
  (quality 90) and can make a file larger. A tenant's logo is not byte-identical to what it uploaded.
- A picture uploaded for two slots is one row, and the tenant cap counts it once.

## Alternatives rejected

- **Accept SVG.** A vector logo is what many brands have, but an SVG is a
  document: script, `foreignObject`, external fetches and CSS. Sanitising it is
  a second parser to keep correct on the authorization server's origin, against
  a rasterised image that cannot do any of it. A tenant exports a PNG.
- **Object storage (S3 or a volume) now.** It scales past the cap and keeps
  blobs out of the database, but adds a service, credentials, a consistency
  problem between a row and an object, and a deletion path for tenants. At 8 MiB
  a tenant the database holds all of it. It stays available behind
  `assetRepository` when a deployment's volume asks for it.
- **A CDN in front of the images.** Images are served with a content hash in
  the path and `Cache-Control: public, immutable`, so any CDN or reverse proxy
  already caches them. Odudu does not provide or require one.
- **Validate without re-encoding** (read magic bytes and strip tags). Checking
  can be fooled by what the checker does not parse; re-encoding keeps only what
  the encoder wrote.
- **A pure-JavaScript decoder.** It avoids a native binary, but none handles all
  three formats, and decoding untrusted images in JavaScript is slower and no
  safer than libvips.

## Amendment, 2026-10-28: a mail names its logo, it does not carry it

A mail's logo is a hosted `<img>` pointing at the same content-addressed brand
URL a page uses, not an inline (CID) attachment.

- The outbox row stores the rendered markup, so the logo address is decided
  when the mail is queued and adds one URL (under 300 bytes) to the row. A
  CID image would add up to 341 KiB of base64 (256 KiB, the logo limit) to every
  row and every message, for every mail of a tenant.
- The route serves an image only while a published version names it. A mail
  queued, or already delivered, under a theme that a later publish replaced
  therefore shows its logo's alt text and the tenant's name, in the box the
  `width` and `height` attributes hold, never a broken layout. A mail
  opened after the tenant changes its logo loses the old one for good; a
  tenant that wants old mail to keep it keeps the logo's hash in a published
  version. Serving archived versions' images too would lift this, at the cost
  of keeping every superseded image reachable, and is left to a decision.
- Many clients block remote images until the reader allows them, so the alt
  text and the tenant name carry the brand without the image. The Odudu mark,
  which no tenant theme replaces, stays an inline attachment and is drawn
  when the theme sets no logo.
- Mail is themed from the tenant's layer, and a client's over it when the
  flow began inside that client's sign-in (see the amendment below).
- The markup is rendered when the mail is queued and stored as it is; the
  sender does not revalidate it. What reaches the row has already passed the
  shell's checks (address shape, whole-number sizes, `#rrggbb`, escaping), so
  altering it needs a write to `email_outbox`, which is not a threat this
  design adds to.
- A theme that cannot be read or built never stops a mail: the read runs in a
  savepoint (`withSavepoint`, two extra statements on a cache miss only), the
  failure is logged once, and the mail goes out unthemed.

## Amendment: a mail wears the client whose sign-in began the flow

The first decision here kept mail to the tenant's layer, on the grounds that no
flow stores a client id. Client branding is the phase's topic and nothing
later takes the mail, so it is now in. A mail takes the client's published
pieces over the tenant's when the flow began inside that client's
authorization request: registration verification and a reset requested from
the sign-in's page.

- **The client comes from server-side state only**: the held sign-in the
  browser's cookie names, accepted under the same condition as the link back
  to it (the page carried that very request). A `client_id`, a `return_to`
  naming another client, or a client of another tenant changes nothing.
- **Nothing stores it.** The mail is queued in the request that holds the
  sign-in, so the client is passed to the mail look and no token or pending
  registration gains a column. A later mail out of a token (an administrator's
  link) has no sign-in and uses the tenant's look.
- **Never from the page cache.** The client's mail is read for each mail, in
  the mail's transaction and a savepoint, with the client's row required to be
  registered in the tenant and enabled; a cached page theme cannot know that.
  The statement count is the same for a known and an unknown address, since
  the read is made before the address is looked up, and the response never
  mentions the client.
- **Fallbacks**: a failed client read gives the tenant's look, then the
  shipped one, each logged. Colours, logo and the tenant's wording only: no
  stylesheet, template or client wording.
- **Residual**: whoever starts an authorization request for a registered,
  enabled client of the tenant can have a mail branded as that client. That is
  the exposure of the client's own page, and the mail's content, links and
  sender are unchanged.
