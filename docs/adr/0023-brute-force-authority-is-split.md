# 0023 — Brute-force authority is split: the account is Postgres's, the CPU is the process's

**Status:** Accepted · 2026-09-16

## Context

RFC 6749 §2.3.1's "MUST protect any endpoint utilizing a password … against
brute force attacks" is already half held. The per-account lockout
(`login_failures`, `packages/domain-identity/src/service/lockout.ts`) counts
consecutive failures per subject, refuses every attempt for a growing
window once the realm's threshold is reached, and is on in every realm by
default. What it does not cover is anything not keyed to an account:

- One password tried against a thousand accounts. Each account sees one
  failure, so no counter ever reaches its threshold, and the server pays an
  Argon2id verification per attempt.
- `POST /realms/{realm}/login-actions/registration`, which is
  unauthenticated and runs an Argon2id **hash** — the expensive direction —
  per request, for an attacker who needs no account at all.
- `POST /realms/{realm}/login-actions/reset-password`, which does a lookup
  and a mail send per request.

These are not account-safety problems. They are cost problems: the resource
being spent is this process's CPU and this deployment's mail quota. That
difference is what the decision below turns on.

### Two places the limit could live

**(a) A row in Postgres, keyed by origin, like `login_failures` is keyed by
subject.** Globally true across replicas, survives a restart, and reuses a
mechanism that already exists.

**(b) A sliding window in this process's memory.** Per instance, lost on
restart, and cheap.

## Decision

**(b), and the split is deliberate: the property that must be globally true
lives in the database, and the property that is local lives locally.**

`slidingWindow` (`apps/server/src/throttle.ts`) keeps a per-key window in
memory. An `onRequest` hook in `apps/server/src/app.ts` applies it, keyed on
`request.ip`, to exactly three routes:
`POST /realms/{realm}/login-actions/authenticate`, `…/registration` and
`…/reset-password`. `ODUDU_THROTTLE_LIMIT` (default `10`) and
`ODUDU_THROTTLE_WINDOW_SECONDS` (default `60`) are the budget. A refused
request answers `429` with `Retry-After` and no body.

Three properties this shape is chosen for:

1. **The refusal is decided before anything account-dependent.** At
   `onRequest` nothing has parsed a body or looked a subject up, so a
   throttled request cannot answer differently for an address the server
   knows than for one it does not. The lockout holds its
   indistinguishability by paying the Argon2id cost either way; the
   throttle holds it by refusing before the question is asked.
2. **A refused request is not recorded.** Retrying inside the window does
   not extend the wait. An attempt during an account lockout deliberately
   does the opposite, because that mechanism is protecting a credential and
   this one is issuing a budget.
3. **The key map is bounded outright**, at `MAX_THROTTLE_KEYS`, evicting
   the least-recently-seen key. A limiter keyed on a value the caller
   chooses is a memory-exhaustion vector of its own, and eviction by
   insertion order would discard the attacker being throttled — that key
   was inserted first — handing back a fresh budget every time the ceiling
   was reached.

**The maximum password length is part of the same decision**, and it is
enforced at the read rather than in the policy. `readPasswordField`
(`packages/kernel/src/password-field.ts`) caps a form-borne password at
`MAX_PASSWORD_LENGTH` = 256 code points, counted the way
`password_min_length` is counted. The tempting home is `evaluatePassword`,
which already owns `minLength` — but the login route does not evaluate the
policy, it _verifies_, so a bound stated only there would leave the one
route an attacker controls paying an Argon2id verification for input of any
length. The cap is therefore at every read, and `evaluatePassword` carries
it as well, so the seed CLI — a writer that reads no form — cannot store a
password the login form would refuse. Over-long input is refused, never
truncated: truncation would make two different passwords authenticate one
account.

256 is not a password-strength opinion. ASVS 2.1.2 asks that at least 64
characters be permitted and allows denying more than 128; this is double
the point at which denial becomes permissible, so no passphrase anybody
would type is refused, and it bounds the attacker-controlled input to the
key derivation at roughly a kilobyte of UTF-8. It is not a realm setting,
because it exists to bound work rather than to shape passwords.

## Consequences

- **The limit is per instance.** N replicas behind a load balancer admit up
  to N × the budget. This is accepted rather than worked around: the
  throttle protects _this process's_ CPU, which is this process's business,
  and the thing that must be true globally — an account locks after five
  consecutive failures, wherever those failures arrive — is the one already
  in Postgres. A per-instance CPU budget with N instances is N instances
  each protecting itself, which is the correct shape for the resource being
  protected.
- **It cannot be demonstrated here.** There is no load balancer in this
  repository and no second replica to put behind one, so `README.md` states
  the limitation rather than showing a transcript nobody produced.
- **Nothing stops a deployment running replicas anyway, so the exposure is
  real rather than theoretical.** "Run one instance" is an instruction in
  `README.md`'s "Deploying" and nowhere else: no boot path refuses a second
  process, and the reason it is given — migrations take no advisory lock —
  is a race an operator may never observe. An operator who scales out gets
  N times the budget, silently. Writing that down is the whole mitigation
  available today; a limit that held across instances is P11's, with the
  shared session cache and the migration lock.
- **A flood from more genuinely distinct addresses than the ceiling holds
  is bounded loosely.** Past `MAX_THROTTLE_KEYS` the coldest key is
  dropped, so a botnet of a hundred thousand real addresses — no header
  spoofing needed — sees its earliest keys forgotten and re-budgeted every
  ten thousand or so insertions. Accepted, because eviction is fail-open
  only: it forgets hits and never invents them, so no volume of keys can
  make the throttle refuse an address that has not spent its budget. A
  bound that instead refused on eviction would turn the ceiling into a
  denial-of-service lever pointed at legitimate traffic.
- **The budget is shared across the three routes**, not one per route. An
  origin gets a CPU allowance, and whether it spends it on logins or on
  registrations is not the throttle's business.
- **It depends on `request.ip` being trustworthy.** With
  `ODUDU_TRUST_PROXY` off, that is the socket's peer address. With it on,
  `X-Forwarded-For` is trusted, so an operator whose proxy _appends_ rather
  than overwrites that header leaves the key client-controlled and the
  throttle decorative. `infra/conformance/proxy/nginx.conf` sets
  `X-Forwarded-For $remote_addr` for exactly this reason, and `README.md`
  says it as a deployment requirement.
- **A shared address shares a budget.** Ten submissions a minute from one
  NAT covers a small office and not a large one, which is what
  `ODUDU_THROTTLE_LIMIT` is for. There is no value that switches it off:
  the floor is one.
- **A restart empties the window.** An attacker who can restart the server
  has larger levers; an attacker who cannot must wait it out.
- **`/token` is not throttled by this.** It is client-authenticated and
  hot, and the budget above is keyed by origin, which for a server-side
  client is one address for every request it will ever make. That is not a
  claim that `/token` needs no protection: RFC 6749 §2.3.1's
  client-authentication half is `deferred: P3` in
  `docs/protocols/rfc6749.md`, with P3's exit criterion naming a `/token`
  rate limit, and what that clause asks for is a limit keyed by _client_.
  This throttle is not where that goes.

## Alternatives rejected

- **(a) Both halves in Postgres, keyed by origin.** Globally true, and it
  would make the limit hold across replicas for free. Rejected for what it
  costs: a write on every request to a throttled route — an `INSERT` or an
  `UPDATE`, never a read, since counting is the whole mechanism — arriving
  exactly when the database is least able to absorb it. A flood that was
  going to cost CPU instead costs write throughput on the one component the
  whole server shares, which converts a CPU-exhaustion attack into a
  database-exhaustion attack and hands the attacker leverage rather than
  taking it away. The lockout can afford a row per subject because it
  writes on _failure_, which an attacker cannot make cheap; a per-origin
  limiter writes on _arrival_, which is exactly what an attacker controls.
- **A shared cache (Redis, or Postgres `UNLOGGED`) for the window.** Holds
  globally and keeps the write off the main tables. Rejected for now
  because it adds a component ADR 0005 exists to avoid, and because it buys
  a global bound on a local resource. It is the right answer if and when
  P11's multi-replica work needs a limit that spans instances — a shared
  session cache is already on that list.
- **A maximum in `evaluatePassword` alone.** The obvious place, and
  insufficient: the login POST never calls it. Kept _in addition_ to the
  read-site cap, so the seed CLI is bound too.
- **Truncating an over-long password instead of refusing it.** Bounds the
  work and silently makes every password sharing a 256-character prefix the
  same password.
- **`preHandler` rather than `onRequest`.** Both precede the Argon2id cost,
  which is the expensive part. `onRequest` additionally precedes the body
  parse, and there is nothing in the decision that needs the body.
- **A `429` carrying a rendered page.** These three routes serve HTML to
  browsers, so a page would be friendlier. An empty body is chosen because
  the refusal must be identical for every request that reaches it, and
  rendering is where per-realm and per-request variation creeps in.
