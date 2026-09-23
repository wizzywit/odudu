# P3b spike: two `__Host-` session cookies, and the size limit

Task 1 of the P3b implementation plan. Answers the two assumptions the
session model (decision 1 of the P3b design spec) depends on, executed
rather than reasoned about, per `CLAUDE.md`'s P0 rule.

## Setup

A throwaway Node HTTP server (not committed) served `/set?n=<count>`,
which set two cookies:

```
__Host-demo-session=<n uuids joined by .>; HttpOnly; SameSite=Lax; Path=/; Secure
__Host-demo-session-persistent=<uuid>; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000
```

and `/`, which echoed back the `Cookie` header it received and its byte
length. Tested with the Claude Code browser tool's Chromium build:

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)
Claude/2.2553.1 Chrome/152.0.7977.76 Safari/537.36
```

i.e. **Chrome 152.0.7977.76**.

## `Secure` over plain `http://localhost`

Chrome treats `http://localhost` as a trustworthy origin. A `Secure`
(and therefore `__Host-`) cookie set over plain HTTP on `localhost:8443`
was accepted and read back on the next request — no self-signed
certificate was needed for this spike. This is a `localhost`-specific
exception; it does not extend to any other plain-HTTP origin.

## Do two `__Host-` cookies, differing only in name, coexist?

Yes. `GET /` after `GET /set?n=10` returned a `Cookie` header containing
both `__Host-demo-session` and `__Host-demo-session-persistent`. The
phase's two-cookie session model (decision 1) is not invalidated.

## Size ceiling

Repeated `GET /set?n=<n>` with the resulting `Cookie` header length read
back from `/`, bisecting once the header length stopped growing with `n`:

| `n` (uuids)            | `Cookie` header length (bytes) | accepted? |
| ---------------------- | ------------------------------ | --------- |
| 80                     | 3048                           | yes       |
| 100                    | 3788                           | yes       |
| **110**                | **4158**                       | **yes**   |
| 111                    | 4158 (unchanged)               | **no**    |
| 115, 120, 160, …, 5120 | 4158 (unchanged)               | no        |

At `n = 111` the browser silently dropped the `Set-Cookie` for
`__Host-demo-session` and kept the last value that had fit (`n = 110`);
no error was surfaced to the page or the server. The `Cookie` header
never grew past 4158 bytes again for any larger `n` tried, up to 5120.

The constraining value is the single cookie's `name=value` pair, not the
combined header: at `n = 110`, `__Host-demo-session=<value>` is
20 + (37×110 − 1) = 4089 bytes, just under the classic 4096-byte
per-cookie limit; at `n = 111` it would be 4126 bytes, over it. This
matches Chrome's enforcement of RFC 6265bis's 4096-octet cap on a
cookie's `name=value` size (attributes such as `HttpOnly`/`Path`/`Secure`
are not counted against that figure).

(Separately, `n = 10240` made the `/set` fetch itself fail with
`ERR_FAILED` — an oversized `Set-Cookie` response header being rejected
outright, a different limit from the per-cookie storage cap above and
not the one this spike is sizing for.)

## Recommended per-browser session cap

**25.**

The observed ceiling is 110 UUIDs before the cookie is silently dropped.
25 leaves a **4.4× headroom** factor (110 / 25 = 4.4), comfortably over
the "at least 4×" bar, to cover the id format changing shape, the
`Path`/attribute overhead, and the rest of what a real request's header
budget has to carry beyond this one cookie — none of which this spike's
minimal demo server contends with.

This is the value Task 3 writes into migration 0048 as the per-tenant
default for the concurrent-session cap enforced when a new session is
created for a `(user, browser)` pair.
