import {
  nextRequiredAction,
  type AcceptTermsOutcome,
  type ProfileProblem,
  type UpdateProfileOutcome,
  type VerifyEmailNotice,
  type VerifyEmailOutcome,
  SUPERSEDED_PASSWORD,
  type ActionStep,
  type EnrolmentRefusal,
  type PasskeyEnrolmentOutcome,
  type PasswordViolation,
  type PendingRequest,
  type RecordActionStep,
  type RecoveryCodesOutcome,
  type RequiredAction,
  type TotpEnrolmentOutcome,
  type UpdatePasswordOutcome,
} from '@odudu/authn-flows';
import { type RequestContext } from '@odudu/domain-audit';
import { isUuid } from '@odudu/kernel';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { owedWithRequested, requestedActionOf, requestedVariant } from '#/service/action-request';

// The page an action goes back to, and the reason it says it is back; each
// action has one reason, so one cannot carry another's.
export type RejectedRequiredAction = {
  kind: 'rejected';
  authSessionId: string;
  subjectId: string;
} & (
  | { action: 'configure-totp'; reason: Extract<EnrolmentRefusal, 'code_mismatch'> }
  | {
      action: 'configure-passkey';
      reason: Extract<EnrolmentRefusal, 'passkey_not_added' | 'passkey_not_discoverable'>;
    }
  | { action: 'generate-recovery-codes'; reason: Extract<EnrolmentRefusal, 'codes_not_saved'> }
);

export type RequiredActionOutcome =
  // No live authentication session, or one whose authentication has not
  // finished: no factor has bound a subject yet, a later factor is still
  // outstanding, or the session has already been spent on a login. Treated
  // exactly as the login form treats a missing auth_session_id — there is
  // nobody to act for, so there is nothing to do.
  | { kind: 'unauthenticated' }
  // The subject does not owe the action this submission claims to satisfy.
  // This is the whole of the endpoint's authorization: passing a factor is
  // permission to finish the login that asked for it, never permission to
  // attach a credential nobody asked for.
  | { kind: 'not_owed'; action: string }
  // An owed action with no submission to satisfy it: configure-passkey on a
  // deployment with no ODUDU_PUBLIC_BASE_URL to derive a relying party from.
  | { kind: 'unsupported'; action: string }
  // The action is done and the parked login is waiting; the caller resumes it.
  | { kind: 'completed'; authSessionId: string }
  // The candidate password did not satisfy the tenant's policy. Every rule
  // it broke is carried, not just the first, so the form it goes back to
  // can list them at once.
  | {
      kind: 'password_rejected';
      authSessionId: string;
      violations: readonly PasswordViolation[];
      requested?: true;
    }
  // The person confirmed replacing the recovery codes they hold: the route
  // issues the new set and shows it.
  | { kind: 'confirmed'; authSessionId: string; subjectId: string; requested: true }
  // The address page, back with what happened: a link was asked for, or the
  // address is still not verified.
  | {
      kind: 'verify_pending';
      authSessionId: string;
      subjectId: string;
      notice: VerifyEmailNotice;
      requested?: true;
    }
  // The profile form, back with every problem and what was typed.
  | {
      kind: 'profile_rejected';
      authSessionId: string;
      subjectId: string;
      problems: readonly ProfileProblem[];
      values: Record<string, string>;
      requested?: true;
    }
  // The terms page, back because the box was not ticked.
  | { kind: 'terms_refused'; authSessionId: string; subjectId: string }
  | (RejectedRequiredAction & { requested?: true });

export interface RequiredActionSubmission {
  authSessionId: string | undefined;
  action: string | undefined;
  secret: string | undefined;
  code: string | undefined;
  // The candidate for the update-password action. Judged against the
  // tenant's policy where it is written, never here.
  password: string | undefined;
  // What proves the password in force, read only for a password change an
  // application asked for.
  currentPassword: string | undefined;
  // The page's cancel control was used.
  cancel: boolean;
  // The confirm control of the recovery-code replacement page was used.
  confirm: boolean;
  // The send control of the address page was used.
  send: boolean;
  // The box of the terms page was ticked.
  accept: boolean;
  // Every field the browser posted as text, for the form of the profile page,
  // which reads only the fields it asked for.
  form: Readonly<Record<string, string>>;
  // The box on the change-password page that ends the person's other sessions
  // was checked. An unchecked box sends nothing, so a submission without the
  // field leaves them.
  endOtherSessions: boolean;
  // The issuer the back-channel logout tokens of an ended session carry.
  issuer: string;
  // The JSON navigator.credentials.create() produced, as the passkey page's
  // hidden field carried it back, and the name the user gave it.
  credential: string | undefined;
  label: string | undefined;
}

export interface RequiredActionSubmissionDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // The subject a *finished* authentication bound to this session, null
  // otherwise. This submission carries no credentials of its own, so that is
  // the whole of what says whose account is being changed — and the subject
  // binding alone would not do, since the first factor writes it while later
  // ones are still outstanding. A required action blocks a login's
  // completion, never its factors.
  authenticatedSubject(tenantId: string, authSessionId: string): Promise<string | null>;
  // Read fresh on every submission, never cached from the login that
  // rendered the page: an action completed in another tab has to be gone
  // by the time this one is submitted.
  pendingActions(tenantId: string, subjectId: string): Promise<readonly RequiredAction[]>;
  // `authSessionId` is the login the code was typed into, which a verified
  // code counts towards as its otp factor.
  // The parked request: what an application asked of this sign-in, and how
  // that has ended so far.
  loadPendingRequest(tenantId: string, authSessionId: string): Promise<PendingRequest | null>;
  // How an action an application requested ended, written to the parked
  // request and the audit trail in one step.
  recordActionStep(
    input: RecordActionStep & { tenantId: string },
    request: RequestContext,
  ): Promise<void>;
  completeTotpEnrolment(
    input: {
      tenantId: string;
      subjectId: string;
      secret: string;
      code: string;
      authSessionId: string;
      replace?: boolean;
    },
    request: RequestContext,
  ): Promise<TotpEnrolmentOutcome>;
  // The acknowledgement that the one render of a subject's recovery codes
  // was seen. It carries no code back — the page that displayed them wrote
  // their hashes, and this submission only says the page was read.
  completeRecoveryCodes(input: {
    tenantId: string;
    subjectId: string;
  }): Promise<RecoveryCodesOutcome>;
  // The fourth writer of a password in a tenant, bound by the same policy as
  // registration, reset redemption and the seed CLI — and the only one that
  // refuses a password the subject has had before.
  completeUpdatePassword(
    input: {
      tenantId: string;
      subjectId: string;
      password: string;
      currentPassword?: string;
      endOtherSessions?: { except: string | null; issuer: string };
    },
    request: RequestContext,
  ): Promise<UpdatePasswordOutcome>;
  // Whether the subject's address is verified now, read again here.
  completeVerifyEmail(tenantId: string, subjectId: string): Promise<VerifyEmailOutcome>;
  // Queues the mail that proves the address on file, within the limit on mail to
  // one address. `verified` where there is nothing left to prove.
  sendVerificationLink(
    tenantId: string,
    subjectId: string,
    request: RequestContext,
  ): Promise<'queued' | 'limited' | 'unavailable' | 'verified'>;
  completeUpdateProfile(
    input: { tenantId: string; subjectId: string; posted: Readonly<Record<string, string>> },
    request: RequestContext,
  ): Promise<UpdateProfileOutcome>;
  completeAcceptTerms(
    input: { tenantId: string; subjectId: string; accepted: boolean },
    request: RequestContext,
  ): Promise<AcceptTermsOutcome>;
  // Absent when no relying party can be derived — see relyingPartyId in
  // @odudu/authn-flows. A passkey enrolled against a guessed RP ID is
  // unusable and silently so, so the action is reported unsupported rather
  // than attempted.
  completePasskeyEnrolment?(
    input: {
      tenantId: string;
      subjectId: string;
      authSessionId: string;
      response: unknown;
      label?: string;
    },
    request: RequestContext,
  ): Promise<PasskeyEnrolmentOutcome>;
}

// What the browser posts is a string; whether it is JSON at all is the
// enrolment's business, so an unparseable field arrives as the `undefined`
// that every other malformed response also produces.
function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function handleRequiredActionSubmission(
  deps: RequiredActionSubmissionDeps,
  tenantName: string,
  submission: RequiredActionSubmission,
  request: RequestContext,
): Promise<RequiredActionOutcome> {
  const { authSessionId, action } = submission;
  // Shape first, for the reason handleLoginSubmission gives: a value
  // Postgres cannot parse as a uuid names no session, and must not reach
  // the comparison that raises on it.
  if (authSessionId === undefined || !isUuid(authSessionId)) {
    return { kind: 'unauthenticated' };
  }

  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return { kind: 'unauthenticated' };

  const subjectId = await deps.authenticatedSubject(tenant.id, authSessionId);
  if (subjectId === null) return { kind: 'unauthenticated' };

  // The gate, before any action-specific handling and for every action this
  // route accepts: passing a factor is not being asked to enrol one, or a
  // stolen password would buy a TOTP credential that outlives the password
  // reset ending the compromise. Compared against the action owed *next*,
  // not mere membership — the order nextRequiredAction imposes is what keeps
  // an expired password from enrolling a second factor, and a submission
  // naming a later action would otherwise walk straight past it.
  const pending = await deps.loadPendingRequest(tenant.id, authSessionId);
  const tenantOwes = await deps.pendingActions(tenant.id, subjectId);
  const owed = owedWithRequested(tenantOwes, pending ?? {});
  const next = nextRequiredAction(owed);
  if (next === null || action !== next) {
    // The link that proves the address clears the action wherever it is opened,
    // so the person who comes back to this page and says they verified it finds
    // nothing owed. The address is checked, and the sign-in carries on: what
    // it still owes is its own gates' to decide.
    if (
      action === 'verify-email' &&
      !owed.includes('verify-email') &&
      (await deps.completeVerifyEmail(tenant.id, subjectId)).kind === 'verified'
    ) {
      return { kind: 'completed', authSessionId };
    }
    return { kind: 'not_owed', action: action ?? '' };
  }
  // Asked for by the application, and ended by this submission either way. It
  // may be left only where the tenant does not also owe it.
  const asked = pending !== null && requestedActionOf(pending) === next;
  const requested = asked && requestedVariant(next, tenantOwes) === next;
  const step = (kind: ActionStep) =>
    deps.recordActionStep(
      { tenantId: tenant.id, authSessionId, subjectId, action: next, step: kind },
      request,
    );

  // The person left an action an application sent them to: nothing is
  // changed, and the sign-in carries on with the ending parked for the response.
  if (submission.cancel && requested) {
    await step('cancelled');
    return { kind: 'completed', authSessionId };
  }
  if (submission.cancel) return { kind: 'not_owed', action: next };
  if (requested && next === 'generate-recovery-codes' && submission.confirm) {
    return { kind: 'confirmed', authSessionId, subjectId, requested: true };
  }

  const outcome = await performAction(
    deps,
    tenant.id,
    subjectId,
    authSessionId,
    next,
    submission,
    request,
    requested,
    pending?.reuseSessionId ?? null,
  );
  if (asked && outcome.kind === 'completed') await step('success');
  return requested && carriesRequestedMark(outcome) ? { ...outcome, requested: true } : outcome;
}

function carriesRequestedMark(
  outcome: RequiredActionOutcome,
): outcome is Extract<
  RequiredActionOutcome,
  { kind: 'password_rejected' | 'rejected' | 'verify_pending' | 'profile_rejected' }
> {
  return (
    outcome.kind === 'password_rejected' ||
    outcome.kind === 'rejected' ||
    outcome.kind === 'verify_pending' ||
    outcome.kind === 'profile_rejected'
  );
}

// Runs the executor the action is owed through. An action an application asked
// for is run with what makes it safe to offer outside a sign-in: the current
// password for a password change, and a swap, not a refusal, for an
// authenticator already held.
async function performAction(
  deps: RequiredActionSubmissionDeps,
  tenantId: string,
  subjectId: string,
  authSessionId: string,
  action: RequiredAction,
  submission: RequiredActionSubmission,
  request: RequestContext,
  requested: boolean,
  sessionInUse: string | null,
): Promise<RequiredActionOutcome> {
  if (action === 'configure-passkey') {
    return completePasskey(deps, tenantId, subjectId, authSessionId, submission, request);
  }

  if (action === 'verify-email') {
    return runVerifyEmail(deps, tenantId, subjectId, authSessionId, submission, request);
  }

  if (action === 'update-profile') {
    const done = await deps.completeUpdateProfile(
      { tenantId, subjectId, posted: submission.form },
      request,
    );
    if (done.kind === 'completed') return { kind: 'completed', authSessionId };
    return {
      kind: 'profile_rejected',
      authSessionId,
      subjectId,
      problems: done.problems,
      values: done.values,
    };
  }

  if (action === 'accept-terms') {
    const done = await deps.completeAcceptTerms(
      { tenantId, subjectId, accepted: submission.accept },
      request,
    );
    if (done.kind === 'accepted') return { kind: 'completed', authSessionId };
    // Terms the tenant no longer has: nothing to show, and the sign-in
    // clears the action the next time it reads what is owed.
    if (done.kind === 'not_configured') return { kind: 'unsupported', action: 'accept-terms' };
    return { kind: 'terms_refused', authSessionId, subjectId };
  }

  if (action === 'generate-recovery-codes') {
    return acknowledgeRecoveryCodes(deps, tenantId, subjectId, authSessionId);
  }

  if (action === 'update-password') {
    const changed = await deps.completeUpdatePassword(
      {
        tenantId,
        subjectId,
        password: submission.password ?? '',
        ...(requested ? { currentPassword: submission.currentPassword ?? '' } : {}),
        ...(submission.endOtherSessions
          ? { endOtherSessions: { except: sessionInUse, issuer: submission.issuer } }
          : {}),
      },
      request,
    );
    if (changed.kind === 'updated') return { kind: 'completed', authSessionId };
    // The action is done, but the password in force is not the one this form
    // carried — saying so is the only honest answer, and the remedy is to
    // sign in with whichever password actually landed.
    if (changed.kind === 'superseded') {
      return {
        kind: 'password_rejected',
        authSessionId,
        violations: [SUPERSEDED_PASSWORD],
      };
    }
    return { kind: 'password_rejected', authSessionId, violations: changed.violations };
  }

  // What is left is configure-totp: the gate above compared `action`
  // against a RequiredAction, so an unrecognised string never reaches here
  // and the four the order names are the four handled.
  const outcome = await deps.completeTotpEnrolment(
    {
      tenantId,
      subjectId,
      secret: submission.secret ?? '',
      code: submission.code ?? '',
      authSessionId,
      ...(requested ? { replace: true } : {}),
    },
    request,
  );

  // already_enrolled is not an error to show the user: a resubmitted form,
  // or a second tab, finds the credential the first one wrote, and the
  // action it was owed for is done either way.
  if (outcome.kind === 'enrolled' || outcome.reason === 'already_enrolled') {
    return { kind: 'completed', authSessionId };
  }
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'configure-totp',
    reason: 'code_mismatch',
  };
}

// A link is asked for with the send control, and the address is checked with
// the other: either can find it verified, which ends the action.
async function runVerifyEmail(
  deps: RequiredActionSubmissionDeps,
  tenantId: string,
  subjectId: string,
  authSessionId: string,
  submission: RequiredActionSubmission,
  request: RequestContext,
): Promise<RequiredActionOutcome> {
  const pending = (notice: VerifyEmailNotice): RequiredActionOutcome => ({
    kind: 'verify_pending',
    authSessionId,
    subjectId,
    notice,
  });
  if (submission.send) {
    const sent = await deps.sendVerificationLink(tenantId, subjectId, request);
    if (sent === 'verified') return { kind: 'completed', authSessionId };
    return pending(sent === 'queued' ? 'sent' : sent);
  }
  const checked = await deps.completeVerifyEmail(tenantId, subjectId);
  return checked.kind === 'verified'
    ? { kind: 'completed', authSessionId }
    : pending('not_verified');
}

// The only refusal is none_issued: the acknowledgement arrived for a
// subject with no codes stored, which is a form submitted without the page
// that issues them ever having rendered. The remedy is that page, so the
// rejection re-renders it with a fresh set.
async function acknowledgeRecoveryCodes(
  deps: RequiredActionSubmissionDeps,
  tenantId: string,
  subjectId: string,
  authSessionId: string,
): Promise<RequiredActionOutcome> {
  const outcome = await deps.completeRecoveryCodes({ tenantId, subjectId });
  if (outcome.kind === 'acknowledged') return { kind: 'completed', authSessionId };
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'generate-recovery-codes',
    reason: 'codes_not_saved',
  };
}

// Both refusals the enrolment can report read the same to whoever is at the
// browser: the ceremony has to be run again, and the retry gets a fresh
// challenge because the page it is rendered on issues one.
async function completePasskey(
  deps: RequiredActionSubmissionDeps,
  tenantId: string,
  subjectId: string,
  authSessionId: string,
  submission: RequiredActionSubmission,
  request: RequestContext,
): Promise<RequiredActionOutcome> {
  const enrol = deps.completePasskeyEnrolment?.bind(deps);
  if (enrol === undefined) return { kind: 'unsupported', action: 'configure-passkey' };

  const outcome = await enrol(
    {
      tenantId,
      subjectId,
      authSessionId,
      response: parseJson(submission.credential),
      ...(submission.label === undefined ? {} : { label: submission.label }),
    },
    request,
  );
  if (outcome.kind === 'enrolled') return { kind: 'completed', authSessionId };
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'configure-passkey',
    reason:
      outcome.reason === 'not_discoverable' ? 'passkey_not_discoverable' : 'passkey_not_added',
  };
}
