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
  holdsSwitch,
  ifMatchOf,
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
  registerFailure,
  registeredText,
  verifyAnswer,
  verifyFailureText,
} from '#/pages/domains/services/outcome';
import type { PasskeyWarning } from '#/pages/domains/services/passkeyWarning';
import { transitionNote } from '#/pages/domains/services/transition';
import { hostProblem, trimmedHost } from '#/pages/domains/services/register';
import {
  addressLine,
  challengesOf,
  domainRows,
  domainsOf,
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
  start: () => void;
}

export interface VerifySection {
  busy: boolean;
  message: string | null;
  run: (domain: Domain) => Promise<void>;
}

export interface ActionSection {
  asking: Asking | null;
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
    send: ({ action, domain }) =>
      writes[action]({ id: domain.id, ifMatch: ifMatchOf(record.etag) }),
    outcomeOf: ({ action, domain }, result) => domainActionOutcome(action, domain.host, result),
  });
  const impact = usePasskeyImpact(tenant, impactTarget(acting.asked));
  const warning: PasskeyWarning = warningFor(acting.asked, impact);
  const held = holdsSwitch(acting.asked, warning, acknowledged);

  const confirm = (): Promise<boolean> => {
    if (held) return Promise.resolve(false);
    return acting.confirm();
  };
  const verify = async (domain: Domain): Promise<void> => {
    const result = await verifying.run(domain.id);
    if (result.ok) {
      const answer = verifyAnswer(result.data);
      setVerifyMessage(answer.verified ? null : answer.text);
      if (answer.verified) toast.succeeded(answer.text);
      return;
    }
    setVerifyMessage(verifyFailureText(domain.host, result));
    refusal.report(result, 'manage-domains');
  };
  const register = (): void => {
    const problem = hostProblem(host);
    setHostError(problem ?? undefined);
    setRegisterMessage(null);
    if (problem !== null) return;
    registering
      .run(trimmedHost(host))
      .then((result) => {
        if (result.ok) {
          setHost('');
          toast.succeeded(registeredText(result.data.host));
          return;
        }
        const outcome = registerFailure(result);
        setHostError(outcome.errors.host);
        setRegisterMessage(outcome.message);
        if (outcome.report) refusal.report(result, 'manage-domains');
      })
      .catch(() => undefined);
  };

  return {
    title: domainsArea().title,
    words: DOMAINS_WORDS,
    record,
    rows: domainRows(domainsOf(record.data)),
    address: addressLine(domainsOf(record.data)),
    transition: transitionNote(),
    challenges: challengesOf(domainsOf(record.data)),
    needs: blockedChanges(authority, CHANGES),
    register: {
      host,
      edit: (value) => {
        setHost(value);
        setHostError(undefined);
      },
      error: hostError,
      message: registerMessage,
      busy: registering.busy,
      start: register,
    },
    verify: { busy: verifying.busy, message: verifyMessage, run: verify },
    action: {
      asking: askingOf(acting.asked, warning),
      held,
      acknowledged,
      acknowledge: setAcknowledged,
      busy,
      problem: acting.problem,
      notice: acting.notice,
      count: acting.done,
      ask: (action, domain) => {
        setAcknowledged(false);
        acting.ask({ action, domain });
      },
      cancel: acting.cancel,
      confirm,
    },
  };
}
