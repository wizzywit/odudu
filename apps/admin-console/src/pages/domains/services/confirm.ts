import type { Domain } from '#/pages/domains/types/domain';
import {
  passkeyWarning,
  switchAllowed,
  type PasskeyWarning,
} from '#/pages/domains/services/passkeyWarning';
import type { PasskeyImpactResponse } from '#/pages/domains/types/domain';
import type { Read } from '#/shared/lib/services/read';
import type { GatewayResult } from '#/shared/lib/services/result';
import { transitionNote } from '#/pages/domains/services/transition';
import type { NamedDialog } from '#/shared/lib/services/dialog';
import { spaced } from '#/shared/lib/services/format';

export type SwitchAction = 'activate' | 'deactivate' | 'remove';

export interface Asked {
  action: SwitchAction;
  domain: Domain;
}

// The address whose passkeys a switch would hide: the host being made the
// address, or the path address on a switch back.
export function impactTarget(asked: Asked | null): string | null {
  switch (asked?.action) {
    case 'activate':
      return asked.domain.host;
    case 'deactivate':
      return 'path';
    default:
      return null;
  }
}

// What a removal does to passkeys is nothing, so only a switch has a warning.
export function warningFor(
  asked: Asked | null,
  impact: Read<PasskeyImpactResponse>,
): PasskeyWarning {
  return impactTarget(asked) === null ? { kind: 'none' } : passkeyWarning(impact);
}

const SIGNED_OUT =
  'Everyone signed in to this tenant is signed out and signs in once more at the new address.';

function warningSentences(warning: PasskeyWarning): string[] {
  return warning.kind === 'none' ? [] : [warning.text];
}

function switchConsequence(lead: string, warning: PasskeyWarning): string {
  return spaced(lead, SIGNED_OUT, transitionNote(), ...warningSentences(warning));
}

function choiceOf(warning: PasskeyWarning): Pick<NamedDialog, 'choice'> {
  return warning.kind === 'acknowledge'
    ? { choice: { label: warning.label, note: warning.note } }
    : {};
}

export function dialogOf({ action, domain }: Asked, warning: PasskeyWarning): NamedDialog {
  switch (action) {
    case 'activate':
      return {
        title: `Make ${domain.host} the tenant’s address?`,
        consequence: switchConsequence(
          `From now on the tenant’s issuer, sign-in pages and the links in its mail are at ${domain.host}.`,
          warning,
        ),
        confirmLabel: 'Make it the address',
        tone: 'primary',
        ...choiceOf(warning),
      };
    case 'deactivate':
      return {
        title: 'Switch back to the path address?',
        consequence: switchConsequence(
          `From now on the tenant’s issuer, sign-in pages and the links in its mail are at the path address again. ${domain.host} stays registered.`,
          warning,
        ),
        confirmLabel: 'Switch back',
        tone: 'primary',
        ...choiceOf(warning),
      };
    case 'remove':
      return {
        title: `Remove ${domain.host}?`,
        consequence: `The record of ${domain.host} is removed. To use it again it must be registered and verified again. The tenant’s address does not change.`,
        confirmLabel: 'Remove domain',
        tone: 'danger',
      };
  }
}

export interface Asking extends Asked {
  dialog: NamedDialog;
}

export function askingOf(asked: Asked | null, warning: PasskeyWarning): Asking | null {
  return asked === null ? null : { ...asked, dialog: dialogOf(asked, warning) };
}

// Whether a switch asked for may not be confirmed yet.
export function holdsSwitch(
  asked: Asked | null,
  warning: PasskeyWarning,
  acknowledged: boolean,
): boolean {
  return asked !== null && !switchAllowed(warning, acknowledged);
}

export interface SwitchWrites {
  activate: (input: { id: string; ifMatch: string }) => Promise<GatewayResult<unknown>>;
  deactivate: (input: { id: string; ifMatch: string }) => Promise<GatewayResult<unknown>>;
  remove: (input: { id: string; ifMatch: string }) => Promise<GatewayResult<unknown>>;
}

const NO_TAG: GatewayResult<never> = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Precondition Required', status: 428 },
};

// A switch is made against the tenant's tag and never sent without one: before
// the domains are read it answers as the server would, a missing precondition.
export function sendSwitch(
  writes: SwitchWrites,
  { action, domain }: Asked,
  etag: string | null,
): Promise<GatewayResult<unknown>> {
  if (etag === null) return Promise.resolve(NO_TAG);
  return writes[action]({ id: domain.id, ifMatch: etag });
}

// What the confirmation draws: closed, or the one asked for.
export interface DialogView {
  isOpen: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  choice: { label: string; note: string } | null;
}

const CLOSED: DialogView = {
  isOpen: false,
  title: '',
  consequence: '',
  confirmLabel: '',
  tone: 'primary',
  choice: null,
};

export function dialogView(asking: Asking | null): DialogView {
  if (asking === null) return CLOSED;
  const { dialog } = asking;
  return { isOpen: true, ...dialog, choice: dialog.choice ?? null };
}
