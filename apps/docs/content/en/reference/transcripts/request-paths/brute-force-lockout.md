---
title: 'Brute-force lockout'
description: 'Five consecutive wrong credentials lock an account — passwords, and after a correct one the codes of a second factor (below) — and the tenant ships…'
---

# Brute-force lockout

Five consecutive wrong credentials lock an account — passwords, and after a
correct one the codes of a second factor ([below](#a-wrong-second-factor-code-counts-too)) — and the tenant ships that
way: the four columns behind it are on in every tenant, unlike every other
credential setting on this page.

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select brute_force_max_failures, brute_force_lockout_seconds,
          brute_force_max_lockout_seconds, brute_force_failure_reset_seconds
     from tenants where name = 'demo';"
```

```
 brute_force_max_failures | brute_force_lockout_seconds | brute_force_max_lockout_seconds | brute_force_failure_reset_seconds
--------------------------+-----------------------------+---------------------------------+-----------------------------------
                        5 |                          60 |                             900 |                             43200
(1 row)
```

The fifth failure locks for a minute, and each failure after that for twice
as long, up to fifteen minutes; twelve hours with no failure forgets the run
and counting starts again from one.

**The refusal says nothing.** A page reading "account locked" would confirm
both that the account exists and that somebody is attacking it — a worse
oracle than the username enumeration the rest of this document works to
close. So a locked account is refused with the response a wrong password
gets, and the response it gets is the page's one message for a refused
password step (`Sign-in failed. Check your details and try again.`), which
names no cause. Below, eight submissions against one parked request: five
wrong passwords, a sixth after the lockout has begun, the _right_ password,
and a username nobody holds. The hash is of the whole response — status
line, headers and body — with six per-response values normalised out:
`date`, `x-request-id`, the CSP script nonce the login page mints for its
passkey button (which appears both in the header and in the markup), the
`auth_session_id` the re-rendered form carries, the username the form gives
back, which is the one typed, and the `content-length` that follows its
length — so the digest is the same value for any parked request rather than
one nobody else can reproduce.

`$SID` is the `auth_session_id` the rendered form carries, taken from the
`/authorize` response the way [the login POST](./path-a-authorization-code-with-pkce.md#3-the-login-post) does.
`ada` had no failures when this began — the tenant's `login_failures` rows
were deleted first, on a stack where the transcripts before it had already
run, so the count below starts from zero.

One thing about reproducing it: eight submissions in a minute from one address
is past the [per-origin throttle](#the-per-origin-throttle) below, so the runs
in this section ran against a stack started with `ODUDU_THROTTLE_LIMIT=1000
ODUDU_LOGIN_THROTTLE_LIMIT=1000 docker compose up -d` — at the defaults, the
later submissions answer `429` (the per-origin budget at ten, the per-username
one at five) and never reach the lockout at all.

```bash
post() {
  curl -sS -D /tmp/h.txt -o /tmp/b.txt \
    --data-urlencode "auth_session_id=$SID" \
    --data-urlencode "username=$1" --data-urlencode "password=$2" \
    'http://localhost:3171/tenants/demo/login-actions/authenticate' >/dev/null
  cat /tmp/h.txt /tmp/b.txt | tr -d '\r' \
    | grep -iv '^date:' | grep -iv '^x-request-id:' \
    | sed 's/nonce-[A-Za-z0-9+/=]*/nonce-NONCE/; s/nonce="[^"]*"/nonce="NONCE"/
           s/auth_session_id" value="[^"]*"/auth_session_id" value="SID"/g
           s/name="username" autocomplete="username" value="[^"]*"/name="username" autocomplete="username" value="USER"/
           s/^content-length: .*/content-length: N/' \
    | shasum -a 256 | cut -c1-32
}

for n in 1 2 3 4 5 6; do echo "$n  wrong password    $(post ada wrong-password)"; done
echo "7  right password    $(post ada correct-horse-battery)"
echo "8  unknown username  $(post nobody wrong-password)"
```

```
1  wrong password    afb5a54113c56b88e7f98987507863c2
2  wrong password    afb5a54113c56b88e7f98987507863c2
3  wrong password    afb5a54113c56b88e7f98987507863c2
4  wrong password    afb5a54113c56b88e7f98987507863c2
5  wrong password    afb5a54113c56b88e7f98987507863c2
6  wrong password    afb5a54113c56b88e7f98987507863c2
7  right password    afb5a54113c56b88e7f98987507863c2
8  unknown username  afb5a54113c56b88e7f98987507863c2
```

The normalised values vary between responses — `date`, the request id and the
nonce between any two, the session id between any two parked requests, and the
typed name and the length that follows it between two submissions that typed
different names — so none of them distinguishes an account that exists from one
that does not, or a locked account from a wrong password. An integration test
makes the same comparison against a real database for four causes at once — a
wrong password, an unknown name, a locked account and a disabled one — with the
typed name masked.

## A wrong second-factor code counts too

A wrong password is not the only guess an attacker can make: whoever holds
the password still has a six-digit code to find. A wrong TOTP code, a wrong
recovery code and a replay of a code already used all count against the same
`login_failures` row as a wrong password, under the same tenant policy, and
the sign-in's correct password does **not** clear the row — only a sign-in
that completes does. Once the account is locked the second-factor step is
refused without the code being looked at, so a locked account cannot say
whether a guess was right, and the refusal is the answer a wrong code gets:
the code form again, with `That code did not work. Check it and try again.`

What is observable is what the session already told its holder: the account
exists, because the password was right. The refusal does not say the account
is locked, and the lockout applies whichever session the guess arrives
through; a recovery code checked against a locked account is not hashed, so
it answers faster than one that is, which tells a holder of the password
nothing the lockout's own effect does not.

The run below is on a stack of its own on `http://localhost:3000`, started on an
empty volume with `ODUDU_THROTTLE_LIMIT=1000 ODUDU_LOGIN_THROTTLE_LIMIT=1000` so
no throttle refuses first. It uses a tenant and a user nothing else in this
document holds, since the run ends with the account locked: `otp-lock` and
`grace`, enrolled for a second factor the way [Two-factor authentication with
TOTP](./two-factor-authentication-with-totp.md) shows, and the `tenants` row at
its defaults (five failures, a minute). `$SID` is an `auth_session_id` whose
password step has just passed, and `$RIGHT` is the code the authenticator would
show now, made with the same implementation that section used:

```bash
post_code() {
  curl -sS -D /tmp/h.txt -o /tmp/b.txt \
    --data-urlencode "auth_session_id=$SID" --data-urlencode "code=$1" \
    'http://localhost:3000/tenants/otp-lock/login-actions/authenticate' >/dev/null
  cat /tmp/h.txt /tmp/b.txt | tr -d '\r' \
    | grep -iv '^date:' | grep -iv '^x-request-id:' \
    | sed 's/nonce-[A-Za-z0-9+/=]*/nonce-NONCE/; s/nonce="[^"]*"/nonce="NONCE"/
           s/auth_session_id" value="[^"]*"/auth_session_id" value="SID"/g' \
    | shasum -a 256 | cut -c1-32
}
for n in 1 2 3 4 5; do echo "$n  wrong code      $(post_code 00000$n)"; done
echo "6  right code      $(post_code $RIGHT)"
```

```
1  wrong code      3b07878ffadaacfa12b3ad3f7811beb6
2  wrong code      3b07878ffadaacfa12b3ad3f7811beb6
3  wrong code      3b07878ffadaacfa12b3ad3f7811beb6
4  wrong code      3b07878ffadaacfa12b3ad3f7811beb6
5  wrong code      3b07878ffadaacfa12b3ad3f7811beb6
6  right code      3b07878ffadaacfa12b3ad3f7811beb6
```

The sixth, the right code, is the same bytes as the five wrong ones. The row
shows why, and that the sixth was counted as well — a refused attempt during
a lockout still counts, as it does for a password:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select u.username, f.failure_count, f.locked_until is not null as locked
     from login_failures f
     join users u on u.subject_id = f.subject_id
     join tenants t on t.id = f.tenant_id
    where t.name = 'otp-lock';"
```

```
 username | failure_count | locked
----------+---------------+--------
 grace    |             6 | t
(1 row)
```

And the password, right this time, in a fresh sign-in, does not get further
than the sign-in form either — the account is locked at the first step too:

```bash
curl -sS -D - -o /tmp/b.txt -X POST \
  'http://localhost:3000/tenants/otp-lock/login-actions/authenticate' \
  --data-urlencode "auth_session_id=$SID2" \
  --data-urlencode 'username=grace' --data-urlencode 'password=correct-horse-battery' \
  | tr -d '\r' | grep -iE '^(HTTP|location)'
grep -o '<title>[^<]*</title>' /tmp/b.txt
```

```
HTTP/1.1 200 OK
<title>Sign in</title>
```

(`$SID2` is a fresh `/authorize` session; no `location` header, so no code.
The lockout and the per-origin throttle are separate: a `429` is the
throttle, and nothing here was refused by it.)
The counter is keyed by **subject**, never by the submitted name — a name
the account no longer answers to would otherwise lock it out, and one it
answers to by email would miss it — which is why the eighth submission above
recorded nothing at all:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -x -c \
  "select subject_id, failure_count, first_failure_at, last_failure_at, locked_until
     from login_failures f join tenants r on r.id = f.tenant_id
     where r.name = 'demo';"
```

```
-[ RECORD 1 ]----+-------------------------------------
subject_id       | 01a13fbd-8144-74d4-891f-4e35e203f63c
failure_count    | 7
first_failure_at | 2026-10-15 13:26:00.007+00
last_failure_at  | 2026-10-15 13:26:00.405+00
locked_until     | 2026-10-15 13:30:00.405+00
```

One row for `ada`, none for the username nobody holds — and seven failures,
not eight. `locked_until` is four minutes past the last of them, because the
count reached seven: a minute at five, two at six, four at seven.

The tenant in that `where` clause is not decoration either. `login_failures`
holds a row per subject across every tenant, and the sections above this one
leave their own behind — the password expiry walkthrough ends on a
deliberately wrong password, and nothing clears a row but a successful login,
the [retention pass](./retention-what-odudu-reap-removes.md), or an operator —
[`DELETE …/subjects/{id}/lockout`](../admin-paths/delete-subjectsidlockout.md)
and `POST …/subjects/{id}/password`, beside the
[`GET …/lockout`](../admin-paths/get-subjectsidlockout.md) that reads it. An unscoped
`select` here would print whatever the rest of this document happened to
do first, which is not a claim about the lockout.

**An attempt made during a lockout is still an attempt**, which is what
keeps a locked account the same cost as an unlocked one — the same read and
the same write, so nothing can be learned from how quickly the refusal comes
back. It also means retrying extends the wait. Five wrong passwords, then
the right one refused, then the same right password once the second lockout
has run out.

**This run needs an account with no failures behind it**, so it runs against a
tenant of its own — `lockout-demo`, seeded exactly as
[Bootstrap](./bootstrap.md) seeds `demo` — rather than continuing the eight
submissions above. Those left `ada` at seven failures in `demo`, and five more
would take the count to twelve and the wait to the fifteen-minute ceiling: the
arithmetic this transcript demonstrates is the arithmetic of a run that starts
from zero.

```bash
LOGIN='http://localhost:3000/tenants/lockout-demo/login-actions/authenticate'
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    --data-urlencode "auth_session_id=$SID" \
    --data-urlencode 'username=ada' --data-urlencode 'password=wrong-password' "$LOGIN"
done
echo '--- the right password, while locked ---'
curl -sS -o /dev/null -w "status %{http_code}, location '%{redirect_url}'\n" \
  --data-urlencode "auth_session_id=$SID" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' "$LOGIN"
sleep 125
echo '--- the same password, 125 seconds later ---'
# A fresh parked request, because the one above has been re-rendered five
# times and this is the submission that completes it.
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$(sid)" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' "$LOGIN" \
  | tr -d '\r' | grep -iE '^(HTTP|location|set-cookie)'
```

```
attempt 1: 200
attempt 2: 200
attempt 3: 200
attempt 4: 200
attempt 5: 200
--- the right password, while locked ---
status 200, location ''
--- the same password, 125 seconds later ---
HTTP/1.1 302 Found
set-cookie: lockout-demo-session=01a1d09b-2049-7319-8269-9aebcc9419dd:Iqz1cvJLnHnxHstQS7sowiwSLvH_pNB4HexwWAxY9Vo; HttpOnly; SameSite=Lax; Path=/
set-cookie: lockout-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: lockout-demo-device=fTXMLwDcnYcMUS4ATE0_HQ; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/lockout-demo/; Max-Age=0
location: http://localhost:8080/callback?code=S4T-6g0xOPWAzUTWyphcF9Uyj-7X41roFdb6COaqL5o&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Flockout-demo
```

(`sid` is the `/authorize` request above with the hidden field read out of the
page it renders, against `lockout-demo`. This block is from a fresh
`lockout-demo`, run after the session cookie gained its secret. The wait is 125
seconds rather than 60 because the refused right password counted as the sixth
failure and re-locked for two minutes.)

A correct password accepted by an **unlocked** account deletes the row, so a
run of failures ends when the account is signed into rather than decaying.
What none of this bounds is an attacker working through many accounts at one
password apiece — every counter stays at one — which is what the throttle
below is for.

## The per-origin throttle

Three unauthenticated submissions each cost real work: the sign-in POST runs
an Argon2id verification, registration runs an Argon2id **hash**, and the
reset request does a lookup and a mail send. They share one budget per
client address (an IPv6 client by its /64; an IPv4-mapped one as its IPv4
address) — `ODUDU_THROTTLE_LIMIT` (default `10`) requests per
`ODUDU_THROTTLE_WINDOW_SECONDS` (default `60`) — and nothing else on this
page is throttled. ADR 0023 is why it is a window in this process's memory
rather than a row.

There is no value that switches the throttle off. A deployment putting many
users behind one address raises the limit, to at most `10000` (the server
refuses to boot past that, naming the variable) over a window of at most `3600`
seconds. (Upgrading: these ceilings were once a million and a day, so a
deployment configured above the new ones fails to start until it is lowered;
ADR 0023 records the change.) A budget of up to 100 keeps an exact log of each
key's requests, about 3 MB at the default of `10` and 9 MB at `100` once 10,000
origins have spent it; above 100 it keeps two counters per key, about 2 MB
however high the limit, at the price of an estimate that can be off by a couple
of requests on steady traffic and by up to the limit on traffic timed against a
window boundary
([ADR 0023](https://github.com/wizzywit/odudu/blob/main/docs/adr/0023-brute-force-authority-is-split.md)).

Two things about the run below, since it is the one section that needs the
default budget rather than the raised one every other transcript here ran with.
It ran against a stack started plainly (`docker compose up -d`), and `demo`'s
`reset_password_allowed` was turned on for it — the route answers `404` in a
tenant that has it off, and a `404` is not what the ten `200`s below are
demonstrating:

```bash
odudu seed tenant --name demo --set reset_password_allowed=true
```

```bash
RESET='http://localhost:3000/tenants/demo/login-actions/reset-password'
for n in $(seq 1 10); do
  curl -sS -o /dev/null -w "request $n: %{http_code}\n" \
    --data-urlencode 'email=ada@example.test' "$RESET"
done
echo '--- the eleventh, from the same address ---'
curl -sS -D - --data-urlencode 'email=ada@example.test' "$RESET" | tr -d '\r'
echo
echo '--- an address this tenant has never seen, still throttled ---'
curl -sS -D - -o /dev/null --data-urlencode 'email=nobody@example.test' "$RESET" \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-type|content-length)'
```

```
request 1: 200
request 2: 200
request 3: 200
request 4: 200
request 5: 200
request 6: 200
request 7: 200
request 8: 200
request 9: 200
request 10: 200
--- the eleventh, from the same address ---
HTTP/1.1 429 Too Many Requests
x-request-id: 01a13f69-ab71-78df-86cd-aad092231823
retry-after: 60
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 895
Date: Thu, 15 Oct 2026 11:54:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Too many attempts</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Too many attempts</h1>
<p>Try again in 60 seconds.</p>
<p>Go back to the previous page when the time is up.</p>
</main>
</body>
</html>
--- an address this tenant has never seen, still throttled ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-type: text/html
content-length: 895
```

A page rather than a bare status, because a person at a browser who submitted
one of these three forms would otherwise be looking at a blank tab. The wait
it names is the `retry-after` header's value, rounded up, and it is the same
page either way: the refusal is decided before the body is parsed or any
account looked up, so it cannot say whether the address was one this tenant
knows, and it offers no link back, since building one would mean reading the
parked sign-in for every refused request. The administrator's three mail
sends (`…/password-reset`, `…/verification`, `…/actions-email`) are called by
programs and keep the empty body, as do `/token`, `/revoke` and
`/introspect`. The budget is shared across the three
routes rather than one per route, the rendered forms are not throttled, and
neither is `/token` — this one, by origin, is not where `/token`'s own
budget lives; [the client_secret budget](#the-client_secret-budget-at-token)
below is:

```bash
echo '--- the sign-in submission shares the same budget ---'
curl -sS -D - -o /dev/null \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' \
  'http://localhost:3000/tenants/demo/login-actions/authenticate' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after)'
echo '--- the form it submits to is not throttled ---'
curl -sS -o /dev/null -w "GET the reset form: %{http_code}\n" \
  'http://localhost:3000/tenants/demo/login-actions/reset-password'
echo '--- and /token is not ---'
for n in 1 2 3; do
  curl -sS -o /dev/null -w "token request $n: %{http_code}\n" \
    --data-urlencode 'grant_type=authorization_code' --data-urlencode 'code=nope' \
    --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
    --data-urlencode 'client_id=demo-spa' --data-urlencode 'code_verifier=x' \
    'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
done
```

```
--- the sign-in submission shares the same budget ---
HTTP/1.1 429 Too Many Requests
retry-after: 54
```

```
--- the form it submits to is not throttled ---
GET the reset form: 200
--- and /token is not ---
token request 1: 400
token request 2: 400
token request 3: 400
```

`retry-after` is what is left of the oldest counted request's minute,
rounded up to a second — `60` after a burst this fast (the sign-in refusal
above came a few seconds later and says `54`), and lower after a
slower one, since the window slides rather than resetting. The three `400`s
are `invalid_grant` on a code that never existed — an OAuth refusal, which
is the point.

**A `429` is the throttle and nothing else.** A lockout refusal is `200` with
the sign-in form, byte-identical to a wrong password, so the two mechanisms are
never confusable from a response — and a burst of wrong passwords big enough to
lock an account is also big enough to exhaust the budget, which is why the
transcripts above this section ran with `ODUDU_THROTTLE_LIMIT` raised.

Two limits this cannot show. The window lives in one process's memory, so **it
is per instance**: N replicas behind a load balancer would each allow the full
budget, and there is no load balancer and no second replica in this repository
to demonstrate that against — so this is a statement, not a transcript. And the
key is `request.ip`, which with `ODUDU_TRUST_PROXY=true` comes from
`X-Forwarded-For`: a proxy that appends rather than overwrites that header
leaves the key client-controlled. Both are deployment
requirements in [Deploying](../../../operating/deploying.md).

## The per-username budget on sign-in

Beside the per-origin budget, the sign-in submission alone carries a second
one, keyed by the address, the tenant and the username as submitted —
`ODUDU_LOGIN_THROTTLE_LIMIT` (default `5`) submissions per
`ODUDU_LOGIN_THROTTLE_WINDOW_SECONDS` (default `60`). One account tried over
and over from one address is refused after five, while the rest of a shared
address is left its ten. The username is read from the form after it is
parsed and before any account is looked up, folded for case, padding and
Unicode compatibility forms, so nothing a lookup could say reaches the
decision, and the refusal is the same `429`, `Retry-After` and page as
the per-origin one. A submission that names no username — the second-factor
and passkey steps carry only the authentication session — is not counted
here, and neither are registration or the reset request. A wrong second-factor
code is bounded per account instead, by the lockout
([a wrong second-factor code counts too](#a-wrong-second-factor-code-counts-too)).

The run below is on a stack of its own on `http://localhost:3171`, its `odudu`
service started with `ODUDU_THROTTLE_LIMIT=1000` and the login budget left at
its default, so the only budget in play is this one. It needs a user nothing
else in this document uses, because the fifth wrong password also locks the
account: `lena`, in the `demo` tenant, seeded for this run alone (`demo` already
held `demo-spa` and `ada`, and `seed` does not add a user to an existing client,
so it is `seed user`).

```bash
odudu seed user --tenant demo --username lena \
  --password correct-horse-battery --email lena@example.com
```

`$SID` is an `auth_session_id` taken from the `/authorize` form. Five wrong
passwords for `lena` are answered with the form, and the sixth is refused;
then the same for a name nobody holds, which is refused in the same bytes:

```bash
attempt() {
  curl -sS -D - -o /dev/null \
    --data-urlencode "auth_session_id=$SID" \
    --data-urlencode "username=$1" --data-urlencode 'password=wrong-password' \
    'http://localhost:3171/tenants/demo/login-actions/authenticate' \
    | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)' | tr '\n' ' '
  echo
}
for n in 1 2 3 4 5; do echo "lena, submission $n: $(attempt lena)"; done
echo '--- the sixth, for lena ---'; attempt lena
echo '--- a username nobody holds, after five of its own ---'
for n in 1 2 3 4 5; do attempt nobody >/dev/null; done; attempt nobody
echo '--- lena again, in other letters ---'; attempt ' LENA '
echo '--- another username, same address ---'; attempt grace
```

```
lena, submission 1: HTTP/1.1 200 OK content-length: 3655
lena, submission 2: HTTP/1.1 200 OK content-length: 3655
lena, submission 3: HTTP/1.1 200 OK content-length: 3655
lena, submission 4: HTTP/1.1 200 OK content-length: 3655
lena, submission 5: HTTP/1.1 200 OK content-length: 3655
--- the sixth, for lena ---
HTTP/1.1 429 Too Many Requests retry-after: 60 content-length: 895
--- a username nobody holds, after five of its own ---
HTTP/1.1 429 Too Many Requests retry-after: 60 content-length: 895
--- lena again, in other letters ---
HTTP/1.1 429 Too Many Requests retry-after: 60 content-length: 895
--- another username, same address ---
HTTP/1.1 200 OK content-length: 3656
```

The fifth wrong password also starts the account lockout, and its answer is
still the form: the `200`s say nothing about which mechanism will refuse
next, which is the point. The budget does not replace the lockout. The
lockout is keyed by the account, holds across addresses and replicas, and
refuses a correct password too; this one is keyed by address and username,
per instance, and costs an attacker nothing but time.

## The `client_secret` budget at `/token`

RFC 6749 §2.3.1's brute-force MUST is client authentication too, and the
lockout and the throttle above don't reach it: the lockout is keyed by
subject, which a client is not, and the throttle's key is one address for
every request a server-side client will ever make. `/token` gets a third,
separate budget instead — a `slidingWindow` of its own, keyed by
`client_id` — consulted only when a `client_secret_basic` or
`client_secret_post` attempt fails. `ODUDU_CLIENT_SECRET_THROTTLE_LIMIT`
(default `5`) attempts per `ODUDU_CLIENT_SECRET_THROTTLE_WINDOW_SECONDS`
(default `60`), mirroring the account lockout's own defaults. ADR 0023's amendment has the design.

A client of its own for this run, so its budget starts clean regardless of
what earlier sections in this document did to `demo-backend`'s:

```bash
odudu seed \
  --tenant demo --client demo-limited --client-secret demo-limited-secret \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri http://localhost:8080/callback
```

```bash
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    -u demo-limited:wrong-secret \
    --data-urlencode 'grant_type=client_credentials' \
    'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
done
echo '--- the sixth, over budget ---'
curl -sS -D - -o /dev/null -u demo-limited:wrong-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
echo '--- the right secret, while the budget is spent ---'
curl -sS -D - -o /dev/null -u demo-limited:demo-limited-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^HTTP'
```

```
attempt 1: 401
attempt 2: 401
attempt 3: 401
attempt 4: 401
attempt 5: 401
--- the sixth, over budget ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
--- the right secret, while the budget is spent ---
HTTP/1.1 200 OK
```

Failures only: the right secret above succeeds anyway, same as the fifth
wrong one did — a healthy client is never throttled, whatever the failure
count on record. That is the trade this budget makes against the account
lockout, deliberately the opposite way: the lockout refuses a correct
password once an account is locked, because it is protecting a credential
from someone who does not hold it; this budget protects the ability to
keep guessing, so someone who finally presents the real secret is let in
regardless.

Unlike the per-origin throttle above — an `onRequest` hook that refuses
before the body is even parsed — this limiter is consulted from inside
`authenticateClient`, in the `catch` after `verifyClientCredentials` has
already run the full comparison. The sixth wrong secret above pays the
Argon2id verification the first five did, and only then is turned into a
`429` instead of a `401`. This budget bounds _guesses_, not CPU: it stops
the seventh, eighth and every later attempt in this window from having a
chance of being right, but it does not save the sixth one's own cost. The
per-origin throttle already covers the CPU case for the routes where an
attacker needs no credential at all; this one is answering a different
question — how many guesses a given client gets — for an endpoint where
skipping the comparison on the exhausting attempt would save one Argon2id
call and nothing more.

An unknown `client_id` spends the same budget a wrong secret against a real
one does, and is refused in the same bytes:

```bash
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    -u nobody-here:anything \
    --data-urlencode 'grant_type=client_credentials' \
    'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
done
echo '--- the sixth, a client_id nobody registered ---'
curl -sS -D - -o /dev/null -u nobody-here:anything \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
```

```
attempt 1: 401
attempt 2: 401
attempt 3: 401
attempt 4: 401
attempt 5: 401
--- the sixth, a client_id nobody registered ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
```

Same status, same headers, same empty body as `demo-limited`'s own sixth attempt
above, and the same budget: five attempts either way before the sixth is
refused. What this does not claim is that the two are indistinguishable in
general — an unknown `client_id` is refused at the client lookup, before
`verifyClientSecret` runs, while a wrong secret against a real client pays the
Argon2id comparison first, so the two paths differ in latency even though their
response bytes and budget consumption match. ADR 0023's amendment records why
that gap is accepted rather than closed with a dummy hash. Like the throttle
above, this one **is per instance** for the same reason — a window in one
process's memory — and that limitation is [Scaling](../../../operating/scaling.md)'s to state.
