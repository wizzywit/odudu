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
and then seven users, one `odudu seed user` each with the password `a long passphrase
for the demo 41` and the address on the right, a second apart so that their creation
times differ:

```bash
odudu seed tenant --name recon-demo
odudu seed user --tenant recon-demo --username grace    --password "$PW" --email Grace@Example.com
odudu seed user --tenant recon-demo --username grace2   --password "$PW" --email grace@example.com
odudu seed user --tenant recon-demo --username lin      --password "$PW" --email Lin@Example.com
odudu seed user --tenant recon-demo --username lin-work --password "$PW" --email lin@example.com --email-verified
odudu seed user --tenant recon-demo --username heidi    --password "$PW" --email Heidi@Example.com
odudu seed user --tenant recon-demo --username heidi2   --password "$PW" --email heidi@example.com
odudu seed user --tenant recon-demo --username solo     --password "$PW" --email solo@example.com
```

```
{"command":"tenant","created":true,"tenant":"recon-demo","tenantId":"01a1d167-67b1-7e36-9e3e-d4714feaafc8"}
```

Each `seed user` prints one line of JSON naming the user, left out here. The page does
not run a sign-in, so the evidence of one is written with `psql`: a session for `grace2`,
and a first use of each credential of `heidi` and `heidi2`, which is what a sign-in
leaves behind.

```bash
psql -U odudu -d odudu -q <<'SQL'
insert into sessions (id, tenant_id, subject_id, expires_at)
select gen_random_uuid(), u.tenant_id, u.subject_id, now() + interval '8 hours'
  from users u where u.username = 'grace2';
update user_credentials set last_used_at = now()
 where subject_id in (select subject_id from users where username in ('heidi', 'heidi2'));
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
 grace    | Grace@Example.com | f        | f        |           1 |        0
 grace2   | grace@example.com | f        | f        |           1 |        1
 lin      | Lin@Example.com   | f        | f        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | f        | f        |           1 |        0
 heidi2   | heidi@example.com | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(7 rows)
```

Three groups share an address. `grace` is the oldest of its pair, `lin-work` has the
verified address of its pair, and both `heidi` accounts have signed in.

## A dry run

`--dry-run` reads and plans and writes nothing. The report says how many groups it found,
how many it would merge, and each group it refuses, by tenant and subject id. Addresses
are never printed.

```bash
odudu reconcile-accounts --dry-run
```

```
{"dry_run":true,"tenants":1,"groups":3,"merged":0,"would_merge":2,"accounts_retired":0,"moved":{"credentials":0,"sessions":0,"grants":0,"consents":0},"refused":1,"failed":0,"refusals":[{"tenant_id":"01a1d167-67b1-7e36-9e3e-d4714feaafc8","reason":"several_have_sign_ins","subject_ids":["01a1d167-81b7-7c79-ac79-534ef4a54a2e","01a1d167-8765-7752-be71-54334905006f"]}],"failures":[]}
```

Two groups would merge. The third is refused with `several_have_sign_ins`: both `heidi`
accounts have signed in, so nothing says which of them is the person. The same query as
above shows the dry run changed nothing:

```
 username |       email       | verified | disabled | credentials | sessions
----------+-------------------+----------+----------+-------------+----------
 grace    | Grace@Example.com | f        | f        |           1 |        0
 grace2   | grace@example.com | f        | f        |           1 |        1
 lin      | Lin@Example.com   | f        | f        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | f        | f        |           1 |        0
 heidi2   | heidi@example.com | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(7 rows)
```

## The run

```bash
odudu reconcile-accounts
```

```
{"dry_run":false,"tenants":1,"groups":3,"merged":2,"would_merge":0,"accounts_retired":2,"moved":{"credentials":0,"sessions":1,"grants":0,"consents":0},"refused":1,"failed":0,"refusals":[{"tenant_id":"01a1d167-67b1-7e36-9e3e-d4714feaafc8","reason":"several_have_sign_ins","subject_ids":["01a1d167-81b7-7c79-ac79-534ef4a54a2e","01a1d167-8765-7752-be71-54334905006f"]}],"failures":[]}
```

The command exits `0`: a refused group is the operator's to settle, and only a group that
failed, or a run that could not start, exits `1`. Its report counts the groups found, the groups merged, the accounts retired and the rows
moved of each kind. The same query again:

```
 username |       email       | verified | disabled | credentials | sessions
----------+-------------------+----------+----------+-------------+----------
 grace    | Grace@Example.com | f        | f        |           1 |        1
 grace2   |                   | f        | t        |           1 |        0
 lin      |                   | f        | t        |           1 |        0
 lin-work | lin@example.com   | t        | f        |           1 |        0
 heidi    | Heidi@Example.com | f        | f        |           1 |        0
 heidi2   | heidi@example.com | f        | f        |           1 |        0
 solo     | solo@example.com  | f        | f        |           1 |        0
(7 rows)
```

- `grace2` was newer than `grace`, so `grace` stays. The session `grace2` had moved to
  `grace`. Its password stayed on `grace2`, since `grace` has one of its own, and
  `grace2` is disabled with its address cleared, so nothing is deleted.
- `lin-work` has the verified address, so it stays and `lin` is retired. Nothing moved from
  `lin`: an unverified account's credentials are not handed to the account that proved the
  address.
- `heidi` and `heidi2` are untouched, and `solo` was never in a group.

Each retired account leaves one audit row naming the one that stayed, and the rows already
in the trail are not touched:

```bash
psql -U odudu -d odudu -q <<'SQL'
select a.action, r.username as retired, s.username as survivor,
       a.detail->>'carried_over' as carried_over, a.detail->'moved' as moved
  from audit_events a
  join users r on r.subject_id::text = a.resource_id
  join users s on s.subject_id::text = a.detail->>'survivor'
 where a.action = 'subject.reconcile'
   and a.tenant_id = (select id from tenants where name = 'recon-demo')
 order by r.username;
SQL
```

```
      action       | retired | survivor | carried_over |                             moved
-------------------+---------+----------+--------------+---------------------------------------------------------------
 subject.reconcile | grace2  | grace    | true         | {"grants": 0, "consents": 0, "sessions": 1, "credentials": 0}
 subject.reconcile | lin     | lin-work | false        | {"grants": 0, "consents": 0, "sessions": 0, "credentials": 0}
(2 rows)
```

## Running it again

```bash
odudu reconcile-accounts
```

```
{"dry_run":false,"tenants":1,"groups":1,"merged":0,"would_merge":0,"accounts_retired":0,"moved":{"credentials":0,"sessions":0,"grants":0,"consents":0},"refused":1,"failed":0,"refusals":[{"tenant_id":"01a1d167-67b1-7e36-9e3e-d4714feaafc8","reason":"several_have_sign_ins","subject_ids":["01a1d167-81b7-7c79-ac79-534ef4a54a2e","01a1d167-8765-7752-be71-54334905006f"]}],"failures":[]}
```

A second run finds only what was refused. Settling `heidi` and `heidi2` by hand, by
disabling one and clearing its address through `PATCH /admin/tenants/<name>/subjects/<id>`,
leaves nothing for the command and nothing to stop the unique index.

The administrator's own `PATCH` refuses to put an address on a subject while another subject
holds it in any case (`409`, as for an exact repeat), so a pair cannot be made again by
that door.
