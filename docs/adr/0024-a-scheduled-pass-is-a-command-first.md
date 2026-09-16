# 0024 — A scheduled pass is a command first, and a timer second

**Status:** Accepted · 2026-09-16

## Context

ADR 0021 settled what `odudu reap` deletes and why each window is what it
is. It left the pass unscheduled: an operator, a cron entry or a Kubernetes
CronJob ran `odudu reap` as a one-shot process, and a deployment that never
set one up grew `authentication_sessions`, `authorization_codes` and
`refresh_tokens` without bound while keeping login metadata for no stated
period. "Self-hostable" and "remember to schedule the garbage collector"
do not sit well together, so the server needs to run the pass itself.

This is the first background loop in the codebase, which makes the shape it
takes a precedent rather than a detail. Three questions had to be answered
before any of it was written.

### Where the exclusion lock lives

`reap` already holds one. `withEachRealmExclusive`
(`packages/db/src/tx.ts`) opens one transaction, takes
`pg_try_advisory_xact_lock` as its first statement, and returns
`{ acquired: false }` without retrying when another instance holds it. So
the loop is **interval, jitter, call** — not interval, jitter, lock, call.
A second lock taken by the scheduler would either be the same key, and
redundant, or a different one, and would break the guarantee by letting two
processes into the pass through separate doors.

### What a pass that throws means for the loop

A background loop that dies quietly is indistinguishable from a working
one. Nothing fails, nothing alerts, and the table grows until somebody
notices months later. The failure mode is not the throw; it is the silence
after it.

### What the pass needs that a boot does not guarantee

`reap` refuses outright, in every environment, without
`ODUDU_APP_DATABASE_URL` (`reap_requires_app_database_url`): its deletes
are scoped by a row-level-security policy that the owner role the
migrations use escapes. The boot guard
(`assertProductionAppDatabaseUrl`) demands that variable only in
production. A development server with the schedule on by default would
therefore have thrown the same error every hour, forever.

## Decision

**The pass stays a usecase with no timer in it, exposed as a command. The
loop is a separate file that holds no logic, and the schedule is decided
once at boot rather than per tick.**

Four parts, each in one place:

1. `apps/server/src/cli/reap.ts` — the pass. Takes `now` and a policy as
   arguments and knows nothing about being scheduled. `odudu reap` remains
   exactly what it was.
2. `apps/server/src/scheduler.ts` — `startScheduler`, taking an interval, a
   jitter, a function and a logger. A timer, a delay, a call, a `catch`
   that logs, and a `stop()` that awaits the pass already in flight. No
   knowledge of retention, no database handle, nothing to mock.
3. `apps/server/src/modules/reap.ts` — the wiring, as an `OduduModule`
   depending on `database`, so a pass cannot run before migrations and the
   loop is stopped before the connections it uses are closed.
4. `ODUDU_REAP_ENABLED` (default on) and `ODUDU_REAP_INTERVAL_SECONDS`
   (default 3600).

The three answers, in the same order as the questions:

- **The lock is the pass's, and the loop does not know about it.** Two
  servers ticking together run one pass between them because
  `withEachRealmExclusive` refuses the second, and the second reports
  `another instance holds the retention lock` rather than a sweep of
  zeros. Jitter — a tenth of the interval, added rather than centred, so
  no tick is ever earlier than the interval configured — keeps replicas
  that booted from the same deployment from contending in the same second.
  Contention costs nothing but a skipped pass, which is why a tenth is
  enough.
- **A pass that throws is logged and the loop reschedules.** The next tick
  runs on time. Ending the loop over one failed pass would stop reaping for
  the life of the process, and nothing would report it; an hourly error in
  the log is a fault somebody can see.
- **The schedule declines to start rather than failing every tick.**
  Without `ODUDU_APP_DATABASE_URL` the module logs one warning naming that
  variable and `ODUDU_REAP_ENABLED=false`, and starts no timer. Production
  never reaches that branch — `assertProductionAppDatabaseUrl` already
  refuses to boot — so the loud failure is kept where it belongs and
  development keeps a server that serves.

## Consequences

- **A default deployment now deletes expired state on its own.** That is a
  behaviour change for anybody who was relying on rows staying put;
  `ODUDU_REAP_ENABLED=false` is the documented way back, and it is the
  setting for a deployment that schedules the command externally.
- **Retention is still a single-flight property, not a single-instance
  one.** Replicas may all schedule it. One wins each tick.
- **`stop()` awaits the pass in flight.** An abandoned pass would be
  harmless — the transaction rolls back and the advisory lock releases on
  rollback as well as on commit — but a process that exits with its own
  database work outstanding turns every shutdown into a log entry nobody
  can tell from a fault.
- **The interval is per process, measured from boot.** There is no shared
  record of when the last pass ran, so a deployment that restarts more
  often than the interval reaps more often than the interval — harmlessly,
  since a pass with nothing to do is a handful of `DELETE`s matching no
  rows.
- **A misconfigured serving role is still discovered per tick.** A role
  that holds `BYPASSRLS` fails `reap_serving_role_bypasses_rls` on every
  pass, logged each time. Checking it at boot would mean a query in the
  module that duplicates the pass's own guard; the loop is deliberately
  logic-free, and a persistent error in the log is the intended signal.

## Alternatives rejected

- **`setInterval` rather than a re-armed `setTimeout`.** Shorter, and
  wrong for a pass whose duration is not bounded: `setInterval` fires
  whether or not the previous pass finished, so a slow pass would overlap
  itself. The overlap would be refused by the advisory lock, which is
  exactly the accident that makes a mechanism look like it is working.
  Re-arming after the pass completes means one pass at a time per process
  by construction.
- **A lock taken in the scheduler.** See above: redundant at best, and at
  worst a second door into the pass.
- **`ODUDU_REAP_ENABLED` defaulting to off.** Safer to roll out and it
  concedes the point the ADR exists to fix — an operator who does nothing
  gets unbounded growth. On by default, with one switch to turn it off.
- **Refusing to boot when the schedule is on and
  `ODUDU_APP_DATABASE_URL` is unset.** Consistent with the other boot
  guards, and it would break every development server started against the
  owner connection — which is the documented local path. Production
  already refuses; outside it the schedule declines and says so.
- **Treating a configuration refusal as fatal to the loop.** Would stop
  the hourly repetition of `reap_requires_app_database_url` and
  `reap_serving_role_bypasses_rls`, at the price of putting a taxonomy of
  errors inside the loop and of letting a loop end itself quietly, which is
  the failure this ADR is most concerned with.
- **A `pg_cron` job, or a `LISTEN`-driven worker.** Both put the schedule
  in the database, which ADR 0005's single-dependency stance would even
  favour. Rejected because the pass is TypeScript — the retention windows,
  the ordering assertion and the role checks are all in
  `apps/server/src/cli/reap.ts` — and a schedule that cannot call it would
  mean reimplementing the rules in SQL, in a second place, where nothing
  would keep the two in step.

## The convention this sets

`CLAUDE.md` gained a "Background work" section from this decision: a
scheduled pass is a usecase with no timer in it, exposed as a command,
with the loop a thin separate file that holds no logic, tested with fake
timers rather than by waiting.
