# Web security, accessibility and mail standards for tenant-authored pages

**Status in Odudu:** this is not one specification. It tables the standards a
page or mail that a tenant's administrators theme has to keep honouring: the
clickjacking and CSP defences of the server-rendered pages, what a consent
page owes the person reading it, the WCAG 2.2 success criteria a stylesheet
could otherwise break, injection through templates, stylesheets, uploads and
mail headers, RFC 3834 for automatic mail, the relay policy the test mail
rides on, and which host is allowed to select a tenant. Where no clause of a standard names the property, the row says so
and carries an `ODUDU-THEME-*` id, or `ODUDU-HOST-*` for the host. The properties are held by unit tests in
`packages/domain-theme`, `packages/kernel`, `packages/email`,
`packages/protocol-oidc`, `packages/protocol-admin`, `packages/account`,
`packages/i18n` and `apps/server`. WCAG criteria are quoted by number and name only; they are
cited from memory of WCAG 2.2, and a clause number here is a pointer, not
a quotation.

## Reading notes

### Who writes a theme

The stylesheet, templates, images and the name a client is shown under are
all written by the tenant's administrators, who are trusted with what they
mean and held to what a page can safely carry. Nothing here defends one
tenant's people against that tenant's own administrator choosing misleading
words; it keeps a theme from running script, from loading a resource that
is not its own, from removing the controls a person needs and from hiding
whose access is being granted.

### Why a template may link anywhere

A template link may name any `https` address, with `rel="noopener noreferrer"`.
Where a tenant sends its people is the tenant's decision, the pages carry no
secret in a URL a link could leak (`referrer-policy: no-referrer` is sent
with every page), and a refused address would only push a tenant to put the
same link in a text no check can read.

### What a stylesheet cannot do

On every part but the decorative ones the checker refuses text under 12px,
boxes under 16px (or 10% of their container) and margins or padding past
128px (50%), `line-height` under 0.8, letter-spacing below -0.05em, faint
text (alpha under 0.5), and text the colour of its own background or of the
Instrument page, panel or sunken surface, unless the rule sets an opaque
ground of its own. Parts that draw their own background (buttons, `.secondary`,
`.alert`, `.choice`) are exempt from the surface comparison. Everywhere it
refuses an outline that is removed, reset, thinner than 1px, faint, pushed
more than 16px away or the colour of the page. It also refuses to hide or
collapse the consent page's heading and scope list unless the rule is scoped
to another page kind.

What it does not catch, and accepts: text and background chosen in two
separate rules, or against a surface the theme chose itself rather than the
Instrument default (the contrast pairs a theme declares are checked at
publish); `currentcolor` or `inherit` as a ground on a heading; relative
sizes such as `font-size: smaller`; an element clipped by `max-height` or
`overflow` at a size above the floor; an outline drawn in `currentcolor` or
dimmed by `opacity`; and a box exactly at the floor. A reader who needs more
than this has the theme's preview.

### What the template checker is held to

A differential test fills templates with the server's own markup and parses
the whole page as a browser does, then compares it with the parse the
checker made, over four seeds of 20,000 generated templates and a list of
hand-written adversarial ones. It found three ways a template could change what a browser
builds from its slots: a part between table parts, a part inside a link, and
the form's opening and closing in different cells. All three are refused.

### Mail

Every message the server sends carries `Auto-Submitted: auto-generated`:
verification, reset, notices, required-action mails and the administrator's
test mail, which the server sends on a click rather than writes. Subjects
and display names are stripped of line breaks before they reach a header.

### Which host selects a tenant

A tenant's address is one of two things: its path under the operator's base address, or one verified
domain. Four properties follow from that and none is a clause of a standard; each has an
`ODUDU-HOST-*` id.

A request is served as a tenant only when its host has a verified row that is the tenant's canonical
address or inside the hour after it stopped being. Every other host selects nothing: one nobody
verified is routed as before, so at the root it reaches no route, and one that is verified but not
live answers the same bare refusal on every path. A pending or failed registration changes nothing
about a host, so registering a name cannot take it from the operator who runs it. A host header is a claim the client makes, which is why the row is the authority and
the header is only the key to it.

Which header is the host depends on `ODUDU_TRUST_PROXY`. With trust off it is `Host` and
`X-Forwarded-Host` is ignored. With it on it is the last entry of `X-Forwarded-Host`, the one the
nearest proxy appended: the first entry is the one a client could have written, and a proxy that
appends rather than replaces leaves it in front. A value that ends in an empty entry names no host.

The proxy's question, `GET /internal/domain-check`, answers `200` or `404` with no body and the same
headers either way, whatever `Host` it was called with, so it tells a caller nothing about which
tenant owns a name, why a name is refused, or whether it is verified but not live. What it does
reveal, which hosts are served, certificate transparency logs and DNS already show, and it takes no
secret for that reason, with its own limiter and a placement off the public network.

Mail links never read `Host`. A link in a message is written from the tenant's canonical address, which
`canonicalAddressFor` resolves from the database and a configured scheme with no request in sight, so a
forged `Host` on a reset request cannot make Odudu mail a link to a host the sender chose.

## Clause table

| Clause            | Level  | Requirement                                                                                                                                                                                                      | Test ID                     | Status                                                                  |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| RFC 6749 §10.13   | MUST   | a page that collects credentials or consent cannot be framed by another origin                                                                                                                                   | `ODUDU-THEME-FRAME-01`      | covered                                                                 |
| CSP 3, directives | SHOULD | each page's policy names only the sources it needs: same-origin style, font and image, the nonce of a script it carries                                                                                          | `ODUDU-THEME-CSP-01`        | covered                                                                 |
| Odudu             | MUST   | an uploaded image or stylesheet is served with `default-src 'none'; sandbox`, nosniff and a cross-origin resource policy                                                                                         | `ODUDU-THEME-ASSET-01`      | covered                                                                 |
| Odudu             | MUST   | an uploaded image is decoded and written again, so a polyglot or a metadata block never reaches a viewer                                                                                                         | `ODUDU-THEME-UPLOAD-01`     | covered                                                                 |
| Odudu             | MUST   | a template holds no script, form, style, event attribute or comment, whatever the payload                                                                                                                        | `ODUDU-THEME-XSS-01`        | covered                                                                 |
| Odudu             | MUST   | a stylesheet reaches no resource, escape or property outside the allow-list, whatever the payload                                                                                                                | `ODUDU-THEME-CSSINJECT-01`  | covered                                                                 |
| Odudu             | MUST   | a template parses, filled with the server's markup, as the checker parsed it: the form keeps its controls                                                                                                        | `ODUDU-THEME-PARSE-01`      | covered                                                                 |
| Odudu             | MAY    | a template link goes to any `https` address                                                                                                                                                                      | —                           | accepted: "Why a template may link anywhere"                            |
| Odudu             | MAY    | a theme and the name a client is shown under are the tenant administrators' own words                                                                                                                            | —                           | accepted: "Who writes a theme"                                          |
| OIDC Core 3.1.2.4 | SHOULD | the consent page tells the person which client is asking, and neither a stylesheet nor a message override can hide that                                                                                          | `ODUDU-THEME-CLIENTNAME-01` | covered                                                                 |
| Odudu             | MUST   | the client a mail wears is the held sign-in's, never one the request carried                                                                                                                                     | `ODUDU-THEME-RESUME-01`     | covered                                                                 |
| OIDC Core 3.1.2.1 | MAY    | `ui_locales` orders the languages a page is shown in                                                                                                                                                             | `ODUDU-THEME-LOCALE-01`     | covered                                                                 |
| WCAG 2.2 1.4.3    | SHOULD | text reaches 4.5:1 against what it sits on; a theme is refused at publish otherwise                                                                                                                              | `ODUDU-THEME-CONTRAST-01`   | covered                                                                 |
| WCAG 2.2 1.4.11   | SHOULD | borders and the focus ring reach 3:1                                                                                                                                                                             | `ODUDU-THEME-CONTRAST-02`   | covered                                                                 |
| WCAG 2.2 1.4.3    | SHOULD | text and background set in two separate rules, or against a theme's own surfaces, are compared                                                                                                                   | —                           | accepted: "What a stylesheet cannot do"                                 |
| WCAG 2.2 1.4.4    | SHOULD | text a stylesheet sets is never smaller than 12px on a needed part, and never collapsed to nothing                                                                                                               | `ODUDU-THEME-LEGIBLE-01`    | covered                                                                 |
| WCAG 2.2 2.4.7    | SHOULD | no stylesheet removes the focus outline                                                                                                                                                                          | `ODUDU-THEME-FOCUS-01`      | covered                                                                 |
| WCAG 2.2 3.1.1    | SHOULD | the page declares its language and direction                                                                                                                                                                     | `ODUDU-THEME-LANG-01`       | covered                                                                 |
| WCAG 2.2 3.1.2    | SHOULD | a passage in another language than the page's is marked with its own language                                                                                                                                    | —                           | deferred: P4h — a client's base name has no language of its own to mark |
| RFC 3834 §5       | SHOULD | automatically generated mail carries `Auto-Submitted` with a value other than `no`                                                                                                                               | `RFC3834-5-01`              | covered                                                                 |
| Odudu             | MUST   | no line break reaches a mail subject from a tenant display name or an override                                                                                                                                   | `ODUDU-THEME-MAILHEADER-01` | covered                                                                 |
| Odudu             | MUST   | a relay is never a loopback, link-local or private address unless the deployment says its relay is internal                                                                                                      | `ODUDU-THEME-RELAY-01`      | covered                                                                 |
| Odudu             | MUST   | a host selects a tenant only through a verified row that is its canonical address or inside its window; a host with no verified row selects nothing and a verified one that is not live answers one bare refusal | `ODUDU-HOST-SELECT-01`      | covered                                                                 |
| Odudu             | MUST   | `X-Forwarded-Host` is read only when the proxy is trusted, and then from its last entry, never one a client could have written ahead of the proxy                                                                | `ODUDU-HOST-FORWARD-01`     | covered                                                                 |
| Odudu             | MUST   | the proxy's domain question answers `200` or `404` with no body and the same headers, whatever the `Host` it was called with                                                                                     | `ODUDU-HOST-CHECK-01`       | covered                                                                 |
| Odudu             | MUST   | a mail link is written from the tenant's canonical address, resolved from the database, never from a request's `Host`                                                                                            | `ODUDU-HOST-MAIL-01`        | covered                                                                 |
