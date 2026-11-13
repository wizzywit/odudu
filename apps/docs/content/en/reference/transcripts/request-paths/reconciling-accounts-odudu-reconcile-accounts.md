---
title: 'Reconciling accounts: odudu reconcile-accounts'
description: 'Accounts that hold one address in different cases are folded into one, and the command says what it merged and what it refused.'
---

# Reconciling accounts: `odudu reconcile-accounts`

`users_email_unique` compares addresses byte for byte, so `Grace@Example.com` and
`grace@example.com` could be two accounts, although registration and a mailed link
treat them as one address. `odudu reconcile-accounts` finds each such group in every
tenant and keeps one account. A later release adds a unique index on
`(tenant_id, email_search)`, which cannot be built while a pair remains, so an
operator runs this command first.

**What ran before.** A freshly built compose stack (`ODUDU_REAP_ENABLED=false`,
`ODUDU_OUTBOX_ENABLED=false`), driven only as far as this page shows: no administrator
was seeded and no one signed in. Tenant `recon-demo` was made with `odudu seed tenant`,
and then eleven users, one `odudu seed user` each with the password `a long passphrase
for the demo 41` and the address shown below, a second apart so that their creation
times differ (`--email-verified` where the table below says so):

```bash
odudu seed tenant --name recon-demo
odudu seed user --tenant recon-demo --username grace    --password "$PW" --email Grace@Example.com --email-verified
odudu seed user --tenant recon-demo --username grace2   --password "$PW" --email grace@example.com --email-verified
odudu seed user --tenant recon-demo --username lin      --password "$PW" --email Lin@Example.com
odudu seed user --tenant recon-demo --username lin-work --password "$PW" --email lin@example.com --email-verified
odudu seed user --tenant recon-demo --username heidi    --password "$PW" --email Heidi@Example.com --email-verified
odudu seed user --tenant recon-demo --username heidi2   --password "$PW" --email heidi@example.com --email-verified
odudu seed user --tenant recon-demo --username ivan     --password "$PW" --email Ivan@Example.com
odudu seed user --tenant recon-demo --username ivan2    --password "$PW" --email ivan@example.com
odudu seed user --tenant recon-demo --username judy     --password "$PW" --email Judy@Example.com --email-verified
odudu seed user --tenant recon-demo --username judy2    --password "$PW" --email judy@example.com
odudu seed user --tenant recon-demo --username solo     --password "$PW" --email solo@example.com
```

```
{"command":"tenant","created":true,"tenant":"recon-demo","tenantId":"01a1d186-9cec-756c-99d8-469e1b652f67"}
```

Each `seed user` prints one line of JSON naming the user, left out here. The page does
not run a sign-in, so the evidence of one is written with `psql`: a session for `heidi2`,
and an audit row recording a successful password sign-in for `heidi` and for `judy2`. That
audit row is what a password sign-in leaves once its session has been reaped; a password
sign-in stamps nothing on the credential.

```bash
psql -U odudu -d odudu -q <<'SQL'
insert into sessions (id, tenant_id, subject_id, expires_at)
select gen_random_uuid(), u.tenant_id, u.subject_id, now() + interval '8 hours'
  from users u where u.username = 'heidi2';
insert into audit_events (id, tenant_id, event_type, action, outcome, actor_subject_id,
                          resource_type, resource_id)
select gen_random_uuid(), u.tenant_id, 'authentication', 'login.password', 'allowed',
       u.subject_id, 'authentication_session', 'digest'
  from users u where u.username in ('heidi', 'judy2');
SQL
```

The state the command starts from, read with this query:

```bash
psql -U odudu -d odudu -q <<'SQL'
select u.username, u.email, u.email_verified as verified, s.disabled_at is not null as disabled,
       (select count(*) from user_credentials c where c.subject_id = u.subject_id) as credentials,
       (select count(*) from sessions x where x.subject_id = u.subject_id) as sessions
  from users u join subjects s on s.id = u.subject_id
 where u.tenant_id = (select id from tenants where name = 'recon-demo')
 order by s.created_at;
SQL
```

```
 username |       email       | verified | disabled | credentials | sessions
----------+-------------------+----------+----------+-------------+----------
 grace    | Grace@Example.com | t        | f        |           1 |        0
 grace2   | grace@example.com | t        | f        |           1 |        0
 lin      | Lin@Example.com   | f        | f        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | t        | f        |           1 |        0
 heidi2   | heidi@example.com | t        | f        |           1 |        1
 ivan     | Ivan@Example.com  | f        | f        |           1 |        0
 ivan2    | ivan@example.com  | f        | f        |           1 |        0
 judy     | Judy@Example.com  | t        | f        |           1 |        0
 judy2    | judy@example.com  | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(11 rows)
```

Five groups share an address. The pairs differ like this: `grace` and `grace2` are both
verified and neither has signed in; `lin-work` has the verified address of its pair;
`heidi` and `heidi2` are both verified and both have signed in; `ivan` and `ivan2` are
both unverified; `judy` is verified and `judy2` is not and has signed in.

## A dry run

`--dry-run` reads and plans and writes nothing. It prints one line for each pair it would
merge, with the address that would be cleared and no `moved` member, since what would move is
not computed, and then a report that counts the groups and lists each group it refuses by
tenant, reason and subject id. The report's `moved` totals are zero on a dry run and are not a
prediction.

```bash
odudu reconcile-accounts --dry-run
```

```
{"event":"would_merge","tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","survivor":"01a1d186-9f5b-7846-8262-946cbc39576f","loser":"01a1d186-a533-75dd-89c3-62fb7055f8fb","former_address":"grace@example.com","carried_over":true}
{"event":"would_merge","tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","survivor":"01a1d186-b16a-7ef0-82e1-561048a1e967","loser":"01a1d186-ab9c-73b1-ba29-ab945db7a583","former_address":"Lin@Example.com","carried_over":false}
{"dry_run":true,"tenants":1,"groups":5,"merged":0,"would_merge":2,"accounts_retired":0,"moved":{"credentials":0,"consents":0},"refused":3,"failed":0,"refusals":[{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"several_have_sign_ins","subject_ids":["01a1d186-b726-7511-8d0c-eda654969552","01a1d186-bd13-785a-a35b-b5c1c4331dd5"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"no_verified_account","subject_ids":["01a1d186-c2d6-7cc7-bf0f-bcd1dbe83886","01a1d186-c87c-7df7-949a-cd0e858421fd"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"unverified_account_has_sign_ins","subject_ids":["01a1d186-ce2a-71a2-b658-e38880a78967","01a1d186-d408-7385-a1f9-f8409099f5a5"]}],"failures":[]}
```

Two pairs would merge, and the other three groups are refused:

- `several_have_sign_ins`: `heidi` has signed in by an audit row alone and `heidi2` by a
  session, so nothing says which of them is the person.
- `no_verified_account`: `ivan` and `ivan2` are both unverified, so nothing says which
  person proved the address.
- `unverified_account_has_sign_ins`: `judy2` is unverified and has signed in, so merging
  it into the verified `judy` would lock out someone the command cannot tell from a
  squatter.

The same query as above shows the dry run changed nothing:

```
 username |       email       | verified | disabled | credentials | sessions
----------+-------------------+----------+----------+-------------+----------
 grace    | Grace@Example.com | t        | f        |           1 |        0
 grace2   | grace@example.com | t        | f        |           1 |        0
 lin      | Lin@Example.com   | f        | f        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | t        | f        |           1 |        0
 heidi2   | heidi@example.com | t        | f        |           1 |        1
 ivan     | Ivan@Example.com  | f        | f        |           1 |        0
 ivan2    | ivan@example.com  | f        | f        |           1 |        0
 judy     | Judy@Example.com  | t        | f        |           1 |        0
 judy2    | judy@example.com  | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(11 rows)
```

## The run

```bash
odudu reconcile-accounts
```

```
{"event":"merged","tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","survivor":"01a1d186-9f5b-7846-8262-946cbc39576f","loser":"01a1d186-a533-75dd-89c3-62fb7055f8fb","former_address":"grace@example.com","carried_over":true,"moved":{"credentials":0,"consents":0}}
{"event":"merged","tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","survivor":"01a1d186-b16a-7ef0-82e1-561048a1e967","loser":"01a1d186-ab9c-73b1-ba29-ab945db7a583","former_address":"Lin@Example.com","carried_over":false,"moved":{"credentials":0,"consents":0}}
{"dry_run":false,"tenants":1,"groups":5,"merged":2,"would_merge":0,"accounts_retired":2,"moved":{"credentials":0,"consents":0},"refused":3,"failed":0,"refusals":[{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"several_have_sign_ins","subject_ids":["01a1d186-b726-7511-8d0c-eda654969552","01a1d186-bd13-785a-a35b-b5c1c4331dd5"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"no_verified_account","subject_ids":["01a1d186-c2d6-7cc7-bf0f-bcd1dbe83886","01a1d186-c87c-7df7-949a-cd0e858421fd"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"unverified_account_has_sign_ins","subject_ids":["01a1d186-ce2a-71a2-b658-e38880a78967","01a1d186-d408-7385-a1f9-f8409099f5a5"]}],"failures":[]}
```

The command exits `0`: a refused group is the operator's to settle, and only a group that
failed, or a run that could not start, exits `1`. The same query again:

```
 username |       email       | verified | disabled | credentials | sessions
----------+-------------------+----------+----------+-------------+----------
 grace    | Grace@Example.com | t        | f        |           1 |        0
 grace2   |                   | f        | t        |           1 |        0
 lin      |                   | f        | t        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | t        | f        |           1 |        0
 heidi2   | heidi@example.com | t        | f        |           1 |        1
 ivan     | Ivan@Example.com  | f        | f        |           1 |        0
 ivan2    | ivan@example.com  | f        | f        |           1 |        0
 judy     | Judy@Example.com  | t        | f        |           1 |        0
 judy2    | judy@example.com  | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(11 rows)
```

- `grace` is the older of two verified accounts, so it stays and `grace2` is retired:
  disabled, its address cleared and its pending links deleted. Nothing is deleted. The
  line the command printed is the only record of `grace@example.com`.
- `lin-work` has the verified address, so it stays and `lin` is retired. Nothing moved
  from `lin`: an unverified account's credentials are not handed to the account that
  proved the address.
- The three refused groups are untouched. Neither of the retired accounts had signed in,
  so nothing moved. Credentials and consents move from a verified account to the survivor
  when the survivor lacks them (a passkey always; a password only where the survivor has
  none), which this page has no passkey or consent to show; the integration tests do.
  Sessions and grants never move: the account that has signed in always survives, and the
  group is read again just before anything is written, so one that signs in meanwhile is
  refused as `loser_signed_in`.

Each retired account leaves one `account.reconciled` audit row naming the one that stayed
and how many credentials and consents moved. It holds no address, and the rows already in the
trail are not touched. A merge is not undone by enabling the account again: what moved
stays with the survivor.

```bash
psql -U odudu -d odudu -q <<'SQL'
select a.action, r.username as retired, s.username as survivor,
       a.detail->>'carried_over' as carried_over, a.detail->'moved' as moved
  from audit_events a
  join users r on r.subject_id::text = a.resource_id
  join users s on s.subject_id::text = a.detail->>'survivor'
 where a.action = 'account.reconciled'
   and a.tenant_id = (select id from tenants where name = 'recon-demo')
 order by r.username;
SQL
```

```
       action       | retired | survivor | carried_over |               moved
--------------------+---------+----------+--------------+-----------------------------------
 account.reconciled | grace2  | grace    | true         | {"consents": 0, "credentials": 0}
 account.reconciled | lin     | lin-work | false        | {"consents": 0, "credentials": 0}
(2 rows)
```

## Running it again

```bash
odudu reconcile-accounts
```

```
{"dry_run":false,"tenants":1,"groups":3,"merged":0,"would_merge":0,"accounts_retired":0,"moved":{"credentials":0,"consents":0},"refused":3,"failed":0,"refusals":[{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"several_have_sign_ins","subject_ids":["01a1d186-b726-7511-8d0c-eda654969552","01a1d186-bd13-785a-a35b-b5c1c4331dd5"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"no_verified_account","subject_ids":["01a1d186-c2d6-7cc7-bf0f-bcd1dbe83886","01a1d186-c87c-7df7-949a-cd0e858421fd"]},{"tenant_id":"01a1d186-9cec-756c-99d8-469e1b652f67","reason":"unverified_account_has_sign_ins","subject_ids":["01a1d186-ce2a-71a2-b658-e38880a78967","01a1d186-d408-7385-a1f9-f8409099f5a5"]}],"failures":[]}
```

A second run finds only what was refused. Settle those groups by hand, for example by
disabling one account and clearing its address through
`PATCH /admin/tenants/<name>/subjects/<id>`, and the command has nothing left, which is what
the later unique index needs.

A sign-in is seen from a live session, a grant, a credential that was used or an audit row
recording a successful sign-in. Audit retention and the reaper delete old rows, so a person
whose only sign-in is older than the tenant's audit retention, with no session left, looks as
if they never signed in. Look at a group you are unsure of before you run the command for real.

The administrator's own `PATCH` refuses to put an address on a subject while another subject
holds it in any case (`409`, as for an exact repeat), so a pair cannot be made again by that
door.
