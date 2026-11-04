import type { PasskeyImpactResponse } from '#/pages/domains/types/domain';
import { groupedNumber } from '#/shared/lib/services/format';
import { readOutcome, type Read } from '#/shared/lib/services/read';
import type { GatewayResult } from '#/shared/lib/services/result';

export type PasskeyWarning =
  | { kind: 'counting'; text: string }
  | { kind: 'none' }
  | { kind: 'acknowledge'; text: string; label: string; note: string };

const COUNTING = 'Counting the subjects whose passkeys this would hide…';

const PASSWORDS = 'Password sign-in is not affected.';

const ACKNOWLEDGE = {
  label:
    'I understand these passkeys stop being offered at sign-in until the address is switched back',
  note: 'Switching back brings the passkeys back, and a person can register another one at the new address.',
} as const;

function countText({ subjects, capped }: PasskeyImpactResponse): string {
  if (capped) return `At least ${groupedNumber(subjects)} subjects hold passkeys`;
  if (subjects === 1) return '1 subject holds a passkey';
  return `${groupedNumber(subjects)} subjects hold passkeys`;
}

// A passkey belongs to the address it was registered at, so a switch hides
// the ones registered at the other address: the caller says it knows first.
export function passkeyWarning(read: Read<PasskeyImpactResponse>): PasskeyWarning {
  switch (read.status) {
    case 'loading':
      return { kind: 'counting', text: COUNTING };
    case 'failed':
      return {
        kind: 'acknowledge',
        text: `The subjects whose passkeys this would hide could not be counted. Passkeys registered at the other address stop being offered at sign-in until you switch back. ${PASSWORDS}`,
        ...ACKNOWLEDGE,
      };
    case 'ready':
      if (read.data.subjects === 0) return { kind: 'none' };
      return {
        kind: 'acknowledge',
        text: `${countText(read.data)} registered at the other address. They stop being offered at sign-in. ${PASSWORDS}`,
        ...ACKNOWLEDGE,
      };
  }
}

export function switchAllowed(warning: PasskeyWarning, acknowledged: boolean): boolean {
  switch (warning.kind) {
    case 'counting':
      return false;
    case 'none':
      return true;
    case 'acknowledge':
      return acknowledged;
  }
}

// A count kept from an earlier ask is not offered while a fresh one is read.
export function impactRead(
  fetching: boolean,
  kept: GatewayResult<PasskeyImpactResponse> | undefined,
  retry: () => void,
): Read<PasskeyImpactResponse> {
  return readOutcome(fetching ? undefined : kept, retry);
}
