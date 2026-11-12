import { createHash } from 'node:crypto';
import { normalisePassword } from '#/service/password';
import { type PolicyViolation } from '#/service/password-policy';

export type BreachedCheckMode = 'off' | 'dataset' | 'remote';
export type BreachedOnError = 'open' | 'closed';

/** What the audit row of a password write records about the check, never more. */
export type BreachedCheckAudit =
  | 'passed'
  | 'breached'
  | 'error_open'
  | 'error_closed'
  | 'off'
  // Nothing was found because the dataset holds no hash at all.
  | 'dataset_empty';

/** What a lookup made before the writing transaction opened came back with. */
export type RemoteOutcome = { kind: 'answered'; breached: boolean } | { kind: 'failed' };

/** The source a precomputed remote outcome stands in for; no outcome counts as a failed lookup. */
export function sourceOfOutcome(outcome: RemoteOutcome | null): BreachedPasswordSource {
  return {
    isBreached: () =>
      outcome?.kind === 'answered'
        ? Promise.resolve(outcome.breached)
        : Promise.reject(new BreachedLookupFailed('no answer')),
  };
}

export interface BreachedPasswordSource {
  isBreached(password: string): Promise<boolean>;
}

/** The one failure a source may report: the answer could not be had, not that it was "no". */
export class BreachedLookupFailed extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`breached-password lookup failed: ${reason}`, options);
    this.name = 'BreachedLookupFailed';
  }
}

export const BREACHED_PASSWORD: PolicyViolation = {
  rule: 'breached-password',
  message: 'That password has appeared in a data breach. Choose a different one.',
};

export const BREACH_CHECK_UNAVAILABLE: PolicyViolation = {
  rule: 'breach-check-unavailable',
  message: 'The password could not be checked against known breaches. Try again.',
};

export interface BreachedHash {
  /** The five characters a range lookup sends. */
  prefix: string;
  /** The thirty-five it keeps. */
  suffix: string;
}

/** The SHA-1 of the NFC form, upper-case hex, split the way the public corpus is. */
export function breachedHash(password: string): BreachedHash {
  const hex = createHash('sha1').update(normalisePassword(password), 'utf8').digest('hex');
  const upper = hex.toUpperCase();
  return { prefix: upper.slice(0, 5), suffix: upper.slice(5) };
}

export interface BreachedSettings {
  check: BreachedCheckMode;
  onError: BreachedOnError;
}

export interface BreachedSources {
  dataset: () => BreachedPasswordSource;
  remote: () => BreachedPasswordSource;
}

export interface BreachedVerdict {
  audit: BreachedCheckAudit;
  violations: PolicyViolation[];
}

/**
 * Asks the source the tenant chose. A failed lookup is the tenant's to settle,
 * open or closed; any other error is a defect and is not turned into an answer.
 */
export async function judgeBreached(
  settings: BreachedSettings,
  sources: BreachedSources,
  password: string,
): Promise<BreachedVerdict> {
  if (settings.check === 'off') return { audit: 'off', violations: [] };
  const source = settings.check === 'remote' ? sources.remote() : sources.dataset();
  try {
    return (await source.isBreached(password))
      ? { audit: 'breached', violations: [BREACHED_PASSWORD] }
      : { audit: 'passed', violations: [] };
  } catch (err) {
    if (!(err instanceof BreachedLookupFailed)) throw err;
    return settings.onError === 'open'
      ? { audit: 'error_open', violations: [] }
      : { audit: 'error_closed', violations: [BREACH_CHECK_UNAVAILABLE] };
  }
}

/** Runs the lookup for a remote tenant only; a failed lookup is an outcome, any other error is not. */
export async function remoteOutcomeOf(
  settings: BreachedSettings,
  ask: () => Promise<boolean>,
): Promise<RemoteOutcome | null> {
  if (settings.check !== 'remote') return null;
  try {
    return { kind: 'answered', breached: await ask() };
  } catch (err) {
    if (!(err instanceof BreachedLookupFailed)) throw err;
    return { kind: 'failed' };
  }
}

/** A dataset that found nothing is told apart from one that holds nothing; asked only then. */
export async function settleEmptiness(
  verdict: BreachedVerdict,
  settings: BreachedSettings,
  datasetIsEmpty: () => Promise<boolean>,
): Promise<BreachedVerdict> {
  if (verdict.audit !== 'passed' || settings.check !== 'dataset') return verdict;
  return (await datasetIsEmpty()) ? { audit: 'dataset_empty', violations: [] } : verdict;
}
