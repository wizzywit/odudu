# Web security, accessibility and mail standards for tenant-authored pages

**Status in Odudu:** this is not one specification. It tables the standards a
page or mail that a tenant's administrators theme has to keep honouring: the
clickjacking and CSP defences of the server-rendered pages, what a consent
page owes the person reading it, the WCAG 2.2 success criteria a stylesheet
could otherwise break, injection through templates, stylesheets, uploads and
mail headers, RFC 3834 for automatic mail, and the relay policy the test mail
rides on. Where no clause of a standard names the property, the row says so
and carries an `ODUDU-THEME-*` id. The properties are held by unit tests in
`packages/domain-theme`, `packages/kernel`, `packages/email`,
`packages/protocol-oidc`, `packages/protocol-admin`, `packages/account` and
`packages/i18n`. WCAG criteria are quoted by number and name only; they are
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

The checker refuses, on every part but the decorative ones, zero or tiny
text and boxes, transparent text and text the colour of its background in
the same rule, and refuses everywhere an outline that is removed. It also
refuses to hide or collapse the consent page's heading, which names the
client, unless the rule is scoped to another page kind. Two parts are not
promised: colours paired across two rules are not compared, so a contrast
failure built from two rules is caught only by the colour pairs the theme
declares, and a box-shadow can still draw over the page.

### What the template checker is held to

A differential test fills templates with the server's own markup and parses
the whole page as a browser does, then compares it with the parse the
checker made. It found three ways a template could change what a browser
builds from its slots: a part between table parts, a part inside a link, and
the form's opening and closing in different cells. All three are refused.

### Mail

Every message the server sends carries `Auto-Submitted: auto-generated`:
verification, reset, notices, required-action mails and the administrator's
test mail, which the server sends on a click rather than writes. Subjects
and display names are stripped of line breaks before they reach a header.

## Clause table

| Clause            | Level  | Requirement                                                                                                              | Test ID                     | Status                                       |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- | -------------------------------------------- |
| RFC 6749 §10.13   | MUST   | a page that collects credentials or consent cannot be framed by another origin                                           | `ODUDU-THEME-FRAME-01`      | covered                                      |
| CSP 3, directives | SHOULD | each page's policy names only the sources it needs: same-origin style, font and image, the nonce of a script it carries  | `ODUDU-THEME-CSP-01`        | covered                                      |
| Odudu             | MUST   | an uploaded image or stylesheet is served with `default-src 'none'; sandbox`, nosniff and a cross-origin resource policy | `ODUDU-THEME-ASSET-01`      | covered                                      |
| Odudu             | MUST   | an uploaded image is decoded and written again, so a polyglot or a metadata block never reaches a viewer                 | `ODUDU-THEME-UPLOAD-01`     | covered                                      |
| Odudu             | MUST   | a template holds no script, form, style, event attribute or comment, whatever the payload                                | `ODUDU-THEME-XSS-01`        | covered                                      |
| Odudu             | MUST   | a stylesheet reaches no resource, escape or property outside the allow-list, whatever the payload                        | `ODUDU-THEME-CSSINJECT-01`  | covered                                      |
| Odudu             | MUST   | a template parses, filled with the server's markup, as the checker parsed it: the form keeps its controls                | `ODUDU-THEME-PARSE-01`      | covered                                      |
| Odudu             | MAY    | a template link goes to any `https` address                                                                              | —                           | accepted: "Why a template may link anywhere" |
| Odudu             | MAY    | a theme and the name a client is shown under are the tenant administrators' own words                                    | —                           | accepted: "Who writes a theme"               |
| OIDC Core 3.1.2.4 | SHOULD | the consent page tells the person which client is asking, and a stylesheet cannot hide that                              | `ODUDU-THEME-CLIENTNAME-01` | covered                                      |
| Odudu             | MUST   | a mail wears the client of the sign-in it was asked from, as the resume link does                                        | `ODUDU-THEME-RESUME-01`     | covered                                      |
| OIDC Core 3.1.2.1 | MAY    | `ui_locales` orders the languages a page is shown in                                                                     | `ODUDU-THEME-LOCALE-01`     | covered                                      |
| WCAG 2.2 1.4.3    | SHOULD | text reaches 4.5:1 against what it sits on; a theme is refused at publish otherwise                                      | `ODUDU-THEME-CONTRAST-01`   | covered                                      |
| WCAG 2.2 1.4.11   | SHOULD | borders and the focus ring reach 3:1                                                                                     | `ODUDU-THEME-CONTRAST-02`   | covered                                      |
| WCAG 2.2 1.4.4    | SHOULD | text a stylesheet sets is never smaller than 12px on a needed part, and never collapsed to nothing                       | `ODUDU-THEME-LEGIBLE-01`    | covered                                      |
| WCAG 2.2 2.4.7    | SHOULD | no stylesheet removes the focus outline                                                                                  | `ODUDU-THEME-FOCUS-01`      | covered                                      |
| WCAG 2.2 3.1.1    | SHOULD | the page declares its language and direction                                                                             | `ODUDU-THEME-LANG-01`       | covered                                      |
| WCAG 2.2 3.1.2    | SHOULD | a passage in another language than the page's is marked with its own language                                            | —                           | gap                                          |
| RFC 3834 §5       | SHOULD | automatically generated mail carries `Auto-Submitted` with a value other than `no`                                       | `RFC3834-5-01`              | covered                                      |
| Odudu             | MUST   | no line break reaches a mail header from a tenant name, a subject or an override                                         | `ODUDU-THEME-MAILHEADER-01` | covered                                      |
| Odudu             | MUST   | a relay is never a loopback, link-local or private address unless the deployment says its relay is internal              | `ODUDU-THEME-RELAY-01`      | covered                                      |
