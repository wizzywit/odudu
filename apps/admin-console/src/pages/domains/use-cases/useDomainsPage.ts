import type { Domain, ListDomainsResponse } from '#/pages/domains/types/domain';
import { useState } from 'react';
import type { Area } from '#/entities/area';
import { useAuthority, useRefusal } from '#/entities/session';
import { usePasskeyImpact } from '#/pages/domains/repository/usePasskeyImpact';
import { useDomainsRecord } from '#/pages/domains/repository/useDomainsRecord';
import {
  useActivateDomain,
  useDeactivateDomain,
  useRegisterDomain,
  useRemoveDomain,
  useVerifyDomain,
} from '#/pages/domains/repository/useDomainWrites';
import {
  askingOf,
  dialogView,
  holdsSwitch,
  type DialogView,
  sendSwitch,
  impactTarget,
  type Asked,
  type Asking,
  type SwitchAction,
  warningFor,
} from '#/pages/domains/services/confirm';
import {
  DOMAINS_WORDS,
  domainsArea,
  type DomainsWords,
} from '#/pages/domains/services/domainsWords';
import {
  domainActionOutcome,
  registerInstruction,
  verifyInstruction,
} from '#/pages/domains/services/outcome';
import type { PasskeyWarning } from '#/pages/domains/services/passkeyWarning';
import { transitionNote } from '#/pages/domains/services/transition';
import { registerLabel, registerRequest } from '#/pages/domains/services/register';
import {
  actionDisabled,
  addressLine,
  challengesOf,
  columnIds,
  domainRows,
  domainsOf,
  type ColumnId,
  type DomainAction,
  type Challenge,
  type DomainRow,
} from '#/pages/domains/services/rows';
import { useToast } from '#/shared/lib/repository/useToasts';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { blockedChanges, type Change } from '#/shared/lib/services/access';
import { useAnnouncedAction } from '#/shared/lib/use-cases/useAnnouncedAction';

const CHANGES: readonly Change[] = [{ change: 'change them', needs: ['manage-domains'] }];

// The gate wraps the page, so it takes the area and the title before anything is read.
export function useDomainsArea(): { area: Area; title: string } {
  return domainsArea();
}

export interface RegisterSection {
  host: string;
  edit: (value: string) => void;
  error: string | undefined;
  message: string | null;
  busy: boolean;
  // What the button says.
  label: string;
  start: () => void;
}

export interface VerifySection {
  busy: boolean;
  message: string | null;
  run: (domain: Domain) => Promise<void>;
}

export interface ActionSection {
  asking: Asking | null;
  dialog: DialogView;
  // The switch may not be confirmed yet: the passkeys it hides are being
  // counted, or the caller has not said it knows they will be hidden.
  held: boolean;
  acknowledged: boolean;
  acknowledge: (checked: boolean) => void;
  busy: boolean;
  problem: string | null;
  // What the last action came to, for the line beside the list.
  notice: string | null;
  // How many actions have ended where they were meant to, for a view that moves focus once the dialog is gone.
  count: number;
  ask: (action: SwitchAction, domain: Domain) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
}

export interface DomainsPage {
  title: string;
  words: DomainsWords;
  record: RecordState<ListDomainsResponse>;
  rows: DomainRow[];
  address: string;
  // How long the previous address keeps serving what it issued, in words.
  transition: string;
  challenges: Challenge[];
  // What the caller may not do here, or null when it may.
  needs: Change | null;
  columns: readonly ColumnId[];
  // Whether an action on a row may not be taken now.
  disabled: (action: DomainAction) => boolean;
  act: (action: DomainAction, domain: Domain) => void;
  register: RegisterSection;
  verify: VerifySection;
  action: ActionSection;
}

export function useDomainsPage(tenant: string): DomainsPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const authority = useAuthority(tenant);
  const record = useDomainsRecord(tenant);
  const registering = useRegisterDomain(tenant);
  const verifying = useVerifyDomain(tenant);
  const activate = useActivateDomain(tenant);
  const deactivate = useDeactivateDomain(tenant);
  const remove = useRemoveDomain(tenant);
  const [host, setHost] = useState('');
  const [hostError, setHostError] = useState<string | undefined>(undefined);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const writes = { activate: activate.run, deactivate: deactivate.run, remove: remove.run };
  const busy = activate.busy || deactivate.busy || remove.busy;
  const acting = useAnnouncedAction<Asked>({
    refusal,
    capability: 'manage-domains',
    blocked: busy,
    send: (asked) => sendSwitch(writes, asked, record.etag),
    outcomeOf: ({ action, domain }, result) => domainActionOutcome(action, domain.host, result),
  });
  const impact = usePasskeyImpact(tenant, impactTarget(acting.asked));
  const warning: PasskeyWarning = warningFor(acting.asked, impact);
  const needs = blockedChanges(authority, CHANGES);
  const held = holdsSwitch(acting.asked, warning, acknowledged);

  const confirm = (): Promise<boolean> => {
    if (held) return Promise.resolve(false);
    return acting.confirm();
  };
  const verify = async (domain: Domain): Promise<void> => {
    const result = await verifying.run(domain.id);
    const told = verifyInstruction(domain.host, result);
    setVerifyMessage(told.message);
    if (told.toast !== null) toast.succeeded(told.toast);
    if (told.report) refusal.report(result, 'manage-domains');
  };
  const register = (): void => {
    const request = registerRequest(host);
    setHostError(request.error);
    setRegisterMessage(null);
    if (request.send === null) return;
    registering
      .run(request.send)
      .then((result) => {
        const told = registerInstruction(host, result);
        setHost(told.host);
        setHostError(told.error);
        setRegisterMessage(told.message);
        if (told.toast !== null) toast.succeeded(told.toast);
        if (told.report) refusal.report(result, 'manage-domains');
      })
      .catch(() => undefined);
  };
  const ask = (action: SwitchAction, domain: Domain): void => {
    setAcknowledged(false);
    acting.ask({ action, domain });
  };
  const doing: Record<DomainAction, (domain: Domain) => void> = {
    verify: (domain) => {
      verify(domain).catch(() => undefined);
    },
    activate: (domain) => {
      ask('activate', domain);
    },
    deactivate: (domain) => {
      ask('deactivate', domain);
    },
    remove: (domain) => {
      ask('remove', domain);
    },
  };

  return {
    title: domainsArea().title,
    words: DOMAINS_WORDS,
    record,
    rows: domainRows(domainsOf(record.data)),
    address: addressLine(domainsOf(record.data)),
    transition: transitionNote(),
    challenges: challengesOf(domainsOf(record.data)),
    needs,
    columns: columnIds(needs !== null),
    disabled: (action) =>
      actionDisabled(action, { tagged: record.etag !== null, verifying: verifying.busy }),
    act: (action, domain) => {
      doing[action](domain);
    },
    register: {
      host,
      edit: (value) => {
        setHost(value);
        setHostError(undefined);
      },
      error: hostError,
      message: registerMessage,
      busy: registering.busy,
      label: registerLabel(registering.busy),
      start: register,
    },
    verify: { busy: verifying.busy, message: verifyMessage, run: verify },
    action: {
      asking: askingOf(acting.asked, warning),
      dialog: dialogView(askingOf(acting.asked, warning), acknowledged, setAcknowledged),
      held,
      acknowledged,
      acknowledge: setAcknowledged,
      busy,
      problem: acting.problem,
      notice: acting.notice,
      count: acting.done,
      ask,
      cancel: acting.cancel,
      confirm,
    },
  };
}
