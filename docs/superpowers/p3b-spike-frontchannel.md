# Spike: what a framed logout URI can still do

**Question:** when a page on the OP's origin frames a `frontchannel_logout_uri`
on a relying party's origin, does the framed request carry the RP's existing
cookie, and may the framed response set one?

**Browser tested:** Chromium 152.0.7977.76 (embedded in the Claude Code
browser tool; full UA string `Mozilla/5.0 (Macintosh; Intel Mac OS X
10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.2553.1
Chrome/152.0.7977.76 Safari/537.36`), on macOS, 2026-09-20. `chrome://`
pages are not reachable through the tool, so the third-party-cookie
setting itself could not be toggled or read directly; the result below is
this build's default.

## Setup, and proving it was genuinely cross-site

Two plain HTTP servers ran on the loopback interface, in the scratchpad
directory, outside the repository:

- **RP**, `http://127.0.0.1:4001` — `GET /` sets a cookie named
  `rp_session` with a value naming the test mode; `GET /logout` reports the
  `cookie` header it received and sets a second cookie, `rp_logout_seen`.
- **OP**, `http://localhost:4002` — serves a page that embeds
  `http://127.0.0.1:4001/logout` in an `<iframe>`.

`127.0.0.1` and `localhost` are different origins _and_ different sites
(neither is a subdomain or registrable-domain match of the other). Two
ports on the same host would not clear that second bar: same-site cookies
flow between them regardless of port, so a pair like `localhost:3000` and
`localhost:4000` would let a cookie through for a reason that has nothing
to do with front-channel logout, and the run would wrongly read as proof
the mechanism works. This was verified rather than assumed: after visiting
the RP
first-party and confirming `document.cookie` held `rp_session` there,
navigating to the OP origin and reading `document.cookie` there returned
`""` — the RP's cookie is invisible to a first-party script on the other
host, so the two are not sharing a cookie jar by site.

## Results

### `SameSite=Lax` (a cookie with no explicit `SameSite`, the browser default)

1. Visited `http://127.0.0.1:4001/` first-party. RP set
   `rp_session=firstparty-lax; Path=/; SameSite=Lax`.
2. Navigated to `http://localhost:4002/frame-lax`, which framed
   `http://127.0.0.1:4001/logout`.
3. The RP's own log of the framed request read
   `cookie=(none)` — the existing session cookie was **not** sent.
4. Re-visited the RP first-party afterward and read `document.cookie`:
   only `rp_session=firstparty-lax` was present. The framed response's
   `Set-Cookie: rp_logout_seen=...` was **not** stored.

### `SameSite=None; Secure`

1. Restarted the RP in `none` mode and visited it first-party. It set
   `rp_session=firstparty-none; Path=/; SameSite=None; Secure` — accepted
   over plain `http://127.0.0.1`, because this Chromium build treats the
   loopback address as a potentially trustworthy origin the same way it
   treats `localhost`. A production RP serves this over real TLS regardless;
   the spike only needed _a_ secure context to exercise the attribute at
   all.
2. Navigated to `http://localhost:4002/frame-none`, framing
   `http://127.0.0.1:4001/logout`.
3. The RP's log of the framed request read
   `cookie=rp_session=firstparty-none` — the existing cookie **was** sent.
4. Re-visited the RP first-party and read `document.cookie`:
   `rp_session=firstparty-none; rp_logout_seen=1-none` — the framed
   response's `Set-Cookie` **was** accepted and persisted.

## The browser's third-party-cookie setting

This build's default let the `SameSite=None; Secure` case through, which
means third-party cookies were not blocked here. That default is not
universal, and this spike did not — could not, through this tool —
exercise the blocked case directly in this browser: `chrome://settings`
is unreachable, so the setting could not be toggled to "block third-party
cookies" and re-run against it.

What is documented behaviour of shipping browsers, cited rather than
measured in this spike: Safari's Intelligent Tracking Prevention has
blocked third-party cookies by default since Safari 13.1 (2020), and
Firefox's Enhanced Tracking Protection blocks known-tracker third-party
cookies in its default (Standard) mode and all third-party cookies in
Strict mode. Chrome itself ships a per-user "Block third-party cookies"
setting that a person or an enterprise policy can enable, which is off by
default in the build tested here.

## What an OP can and cannot promise

**Delivery cannot be guaranteed.** Two independent failure modes exist,
and either one alone is enough to make a framed `frontchannel_logout_uri`
silently do nothing at the RP:

1. An RP whose logout cookie has no explicit `SameSite` — the ordinary,
   spec-default case — never receives it on a framed cross-site request.
   This is not a third-party-cookie _setting_ at all; it is the browser's
   unconditional `SameSite=Lax` default, observed here and true of every
   current major browser. An RP has to opt in to `SameSite=None; Secure`
   for its logout cookie specifically for the OP's iframe to have any
   chance of reaching it.
2. Even an RP that does opt in is at the mercy of the browser's or the
   user's third-party-cookie policy, which Safari and Firefox already
   deny by default and which Chrome lets a user or an administrator deny.

The most an OP can honestly claim is the **attempt**: render the iframe,
name the RP correctly, and give it every parameter (`iss`, `sid`) the RP
would need to act on the request if the cookie does arrive. Whether the
RP's own session actually ends is outside the OP's control and cannot be
observed by the OP — the iframe's response is not read back. This is the
wording the phase's exit criterion and ADR use: front-channel logout is
_attempted_ against every registered URI, never asserted as delivered.
