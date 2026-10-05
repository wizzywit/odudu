import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useAdministratorGrant } from '#/features/system-admins/repository/useAdministratorChange.ts';
import { usePickerHolders } from '#/features/system-admins/repository/usePickerHolders.ts';
import { useSubjectPicker } from '#/features/system-admins/repository/useSubjectPicker.ts';
import { subjectName } from '#/features/system-admins/service.ts';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/tenants';
import type { Refused } from '#/shared/repository/administratorRoles.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  administratorNeeds,
  GRANT_REQUESTS,
  TENANT_ADMIN,
} from '#/shared/service/administrators.ts';
import { blockedChanges, lacking, type Change } from '#/shared/service/access.ts';
import {
  CAPABILITY_TEXT,
  ceilingOf,
  fullText,
  holdingLabel,
  holdingsIn,
  includedBy,
  isHolding,
} from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';

export interface HoldingOption {
  id: string;
  label: string;
  description: string;
  note: string | null;
  unavailable: string | null;
}

export interface SystemAdministrators {
  createNeeds: readonly AdminCapability[];
  // What changing anybody's capabilities needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  blocked: Change | null;
  begin: BeginAdministrator;
  picker: PickerState<Subject>;
  // Why a subject is not offered: it already holds something, changed in the list.
  unavailableOf: (subject: Subject) => string | null;
  chosen: Subject | null;
  choose: (id: string | null) => void;
  holdings: readonly string[];
  holdingOptions: readonly HoldingOption[];
  chooseHoldings: (holdings: readonly string[]) => void;
  holdingsError: string | undefined;
  grant: () => void;
  busy: boolean;
  // Why the last grant did not happen, said beside the Grant button.
  grantMessage: string | null;
}

function refusalText(name: string, refused: Refused): string {
  const { failure, request } = refused;
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${name} was given it. Check the list before trying again.`;
    case 'schema':
      return `${name} may have been given it, but the answer could not be read. Check the list.`;
    case 'defect':
      return `The console could not finish, so ${name} was not given it. This is a fault in the console, not something you did.`;
    case 'problem': {
      const { problem } = failure;
      const why =
        problem.status === 403
          ? (problem.detail ?? `it needs the ${ADMINISTRATOR_REQUEST_NEEDS[request]} capability`)
          : problem.status === 412
            ? 'their roles changed while this ran. Try again'
            : (problem.detail ?? problem.title);
      return `${name} was not given it: ${why}.`;
    }
  }
}

export function useSystemAdministratorsPage(): SystemAdministrators {
  const authority = useAuthority(SYSTEM_TENANT);
  const refusal = useRefusal(SYSTEM_TENANT);
  const picker = useSubjectPicker();
  const change = useAdministratorGrant();
  const begin = useBeginAdministrator(SYSTEM_TENANT, 'existing');
  const toast = useToasts((queue) => queue.push);
  const [chosen, setChosen] = useState<Subject | null>(null);
  const [holdings, setHoldings] = useState<readonly string[]>([TENANT_ADMIN]);
  const [holdingsError, setHoldingsError] = useState<string | undefined>(undefined);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);

  const creating = administratorNeeds(SYSTEM_TENANT, { subjectId: null, granted: false });
  const granting = [
    ...new Set([...GRANT_REQUESTS.map((request) => ADMINISTRATOR_REQUEST_NEEDS[request])]),
  ];
  const createNeeds = lacking(authority, creating);
  const changeNeeds = lacking(authority, ['manage-users']);
  const blocked = blockedChanges(authority, [
    { change: 'create them', needs: creating },
    { change: 'change what they hold', needs: granting },
  ]);
  const holders = usePickerHolders(picker.query);
  const caller = authority?.capabilities;

  return {
    createNeeds,
    changeNeeds,
    blocked,
    begin: {
      ...begin,
      start: () => {
        if (createNeeds.length === 0) begin.start();
      },
    },
    picker,
    unavailableOf: (subject) =>
      holders?.has(subject.id) === true
        ? 'already holds a capability: change it in the list'
        : null,
    chosen,
    choose: (id) => {
      const option =
        id === null || holders?.has(id) === true
          ? undefined
          : picker.options.find((o) => o.id === id);
      setChosen(option ?? null);
    },
    holdings,
    holdingOptions: holdingsIn(SYSTEM_TENANT).map((holding) => {
      const carrier = includedBy(holding, holdings);
      return {
        id: holding,
        label: holdingLabel(holding),
        description: holding === TENANT_ADMIN ? fullText(SYSTEM_TENANT) : CAPABILITY_TEXT[holding],
        note: carrier === null ? null : `Carried by ${holdingLabel(carrier)}.`,
        unavailable: caller === undefined ? null : ceilingOf(SYSTEM_TENANT, holding, caller),
      };
    }),
    chooseHoldings: (next) => {
      setHoldingsError(undefined);
      setHoldings(holdingsIn(SYSTEM_TENANT).filter((holding) => next.includes(holding)));
    },
    holdingsError,
    grant: () => {
      if (chosen === null || change.busy) return;
      if (holdings.length === 0) {
        setHoldingsError('Choose Full, or at least one capability.');
        return;
      }
      const name = subjectName(chosen);
      setGrantMessage(null);
      change
        .grant(chosen.id, holdings)
        .then((outcome) => {
          if (outcome !== null) {
            refusal.report(outcome.failure, ADMINISTRATOR_REQUEST_NEEDS[outcome.request]);
            setGrantMessage(refusalText(name, outcome));
            return;
          }
          setChosen(null);
          toast({
            tone: 'success',
            message: `${name} now holds ${holdings.filter(isHolding).map(holdingLabel).join(', ')} in system.`,
          });
        })
        .catch(() => undefined);
    },
    busy: change.busy,
    grantMessage,
  };
}
