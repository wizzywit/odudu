import {
  createFailure,
  isMissing,
  isStale,
  problemSubtype,
  staleWhenTagMissing,
  writeFailureText,
  type CreateOutcome,
  type RemovalOutcome,
} from '#/shared/lib/services/failure';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { sentence } from '#/shared/lib/services/format';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/lib/services/result';
import type { SwitchAction } from '#/pages/domains/services/confirm';
import type { Domain } from '#/pages/domains/types/domain';

const CAPABILITY = 'manage-domains';

const VERB: Record<SwitchAction, string> = {
  activate: 'made the address',
  deactivate: 'switched back',
  remove: 'removed',
};

const CHANGED_TEXT =
  'The tenant’s address was changed by somebody else while this was open, so nothing was done. The domains are read again: look at them, then repeat the change if it still applies.';
const GONE_TEXT = 'That domain is already gone. The domains are read again.';

function successText(action: SwitchAction, host: string): string {
  switch (action) {
    case 'activate':
      return `${host} is now the tenant’s address.`;
    case 'deactivate':
      return 'The tenant signs in at its path address again.';
    case 'remove':
      return `${host} was removed.`;
  }
}

function refusalText(problem: Problem): string | null {
  switch (problemSubtype(problem)) {
    case 'domain-not-verified':
      return 'Only a verified domain can become the tenant’s address. Verify it first.';
    case 'domain-canonical':
      return 'This domain is the tenant’s address. Switch back to the path address, then remove it.';
    case 'domain-no-base-url':
      return 'This server has no public base URL configured, so no domain can be served. The operator sets it.';
    default:
      return writeRefusal(problem, CAPABILITY);
  }
}

// A stale tag, a switch that landed first, or a domain that went meanwhile
// all mean what was asked is out of date: the dialog closes and says so.
function outOfDate(action: SwitchAction, result: GatewayFailure): boolean {
  if (isStale(result)) return true;
  if (result.kind === 'problem' && problemSubtype(result.problem) === 'domain-switch-conflict') {
    return true;
  }
  return action !== 'remove' && isMissing(result);
}

export function domainActionOutcome(
  action: SwitchAction,
  host: string,
  answer: GatewayResult<unknown>,
): RemovalOutcome {
  const result = staleWhenTagMissing(answer);
  if (result.ok) return { done: true, text: successText(action, host) };
  if (action === 'remove' && isMissing(result)) return { done: true, text: GONE_TEXT };
  if (outOfDate(action, result)) {
    return {
      done: false,
      closes: true,
      text: isMissing(result) ? GONE_TEXT : CHANGED_TEXT,
    };
  }
  return {
    done: false,
    text: writeFailureText(result, {
      name: host,
      verb: VERB[action],
      lookAt: 'the domains',
      refused: refusalText,
    }),
  };
}

export function registeredText(host: string): string {
  return `${host} was registered. Publish the TXT record shown for it, then verify it.`;
}

const VERIFY_REFUSALS: Readonly<Record<string, (host: string) => string>> = {
  'domain-failed': (host) =>
    `${host} still does not show its record. The record it was registered with must still be published at the DNS provider; if it is gone, remove the domain and register it again for a new one.`,
  'domain-verify-throttled': (host) =>
    `${host} or this tenant was checked too recently. Wait a little, then verify again.`,
  'domain-verified-elsewhere': (host) =>
    `${host} cannot be verified here: another tenant proved ownership of it first.`,
};

export function verifyFailureText(host: string, failure: GatewayFailure): string {
  const named =
    failure.kind === 'problem' ? VERIFY_REFUSALS[problemSubtype(failure.problem)] : undefined;
  if (named !== undefined) return named(host);
  return writeFailureText(failure, {
    name: host,
    verb: 'verified',
    lookAt: 'the domains',
    refused: (problem) => writeRefusal(problem, CAPABILITY),
  });
}

// A host the server refuses belongs under the field; the rest are about the tenant.
function placedUnderHost(problem: Problem): boolean {
  return problem.status === 422 || problemSubtype(problem) === 'domain-already-registered';
}

export function registerFailure(failure: GatewayFailure): CreateOutcome {
  if (failure.kind === 'problem' && placedUnderHost(failure.problem)) {
    const { detail, title } = failure.problem;
    return {
      unconfirmed: false,
      errors: { host: sentence(detail ?? title) },
      message: null,
      report: false,
    };
  }
  return createFailure(failure, {
    noun: 'domain',
    name: 'the domain',
    fields: ['host'],
    capability: CAPABILITY,
    refused: (problem) =>
      refusalText(problem) ??
      (problem.status === 409 ? sentence(problem.detail ?? problem.title) : null),
  });
}

// What the page does with an answer: the line it keeps, the toast it shows,
// and whether a refusal means the caller's authority is in doubt.
export interface Instruction {
  message: string | null;
  toast: string | null;
  report: boolean;
}

// A verification that finds no record is not a failure: the domain stays as it was.
export function verifyInstruction(host: string, result: GatewayResult<Domain>): Instruction {
  if (!result.ok) {
    return { message: verifyFailureText(host, result), toast: null, report: true };
  }
  if (result.data.state === 'verified') {
    return {
      message: null,
      toast: `${result.data.host} is verified. It can now be made the tenant’s address.`,
      report: false,
    };
  }
  return {
    message: `${result.data.host} does not show its record yet. DNS can take a while to show a new one: check the record, then verify again.`,
    toast: null,
    report: false,
  };
}

export interface RegisterInstruction extends Instruction {
  // What the field holds afterwards.
  host: string;
  error: string | undefined;
}

export function registerInstruction(
  typed: string,
  result: GatewayResult<Domain>,
): RegisterInstruction {
  if (result.ok) {
    return {
      host: '',
      error: undefined,
      message: null,
      toast: registeredText(result.data.host),
      report: false,
    };
  }
  const outcome = registerFailure(result);
  return {
    host: typed,
    error: outcome.errors.host,
    message: outcome.message,
    toast: null,
    report: outcome.report,
  };
}
