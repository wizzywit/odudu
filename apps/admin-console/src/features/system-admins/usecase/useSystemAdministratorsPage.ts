import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useAdministratorGrant } from '#/features/system-admins/repository/useAdministratorChange.ts';
import { usePickerHolders } from '#/features/system-admins/repository/usePickerHolders.ts';
import { useSubjectPicker } from '#/features/system-admins/repository/useSubjectPicker.ts';
import {
  administratorsAccess,
  choosable,
  grantedText,
  grantFailureText,
  pickerUnavailable,
  subjectName,
} from '#/features/system-admins/service.ts';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/tenants';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { Change } from '#/shared/service/access.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  holdingsProblem,
  TENANT_ADMIN,
} from '#/shared/service/administrators.ts';
import { holdingOptions, holdingsIn, type HoldingOption } from '#/shared/service/capabilities.ts';
import { inOrderOf } from '#/shared/service/ids.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';

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

  const { createNeeds, changeNeeds, blocked } = administratorsAccess(authority);
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
    unavailableOf: (subject) => pickerUnavailable(holders, subject),
    chosen,
    choose: (id) => {
      setChosen(choosable(id, holders, picker.options));
    },
    holdings,
    holdingOptions: holdingOptions(SYSTEM_TENANT, holdings, caller),
    chooseHoldings: (next) => {
      setHoldingsError(undefined);
      setHoldings(inOrderOf(holdingsIn(SYSTEM_TENANT), next));
    },
    holdingsError,
    grant: () => {
      if (chosen === null || change.busy) return;
      const problem = holdingsProblem(holdings);
      if (problem !== null) {
        setHoldingsError(problem);
        return;
      }
      const name = subjectName(chosen);
      setGrantMessage(null);
      change
        .grant(chosen.id, holdings)
        .then((outcome) => {
          if (outcome !== null) {
            refusal.report(outcome.failure, ADMINISTRATOR_REQUEST_NEEDS[outcome.request]);
            setGrantMessage(grantFailureText(name, outcome));
            return;
          }
          setChosen(null);
          toast({ tone: 'success', message: grantedText(name, holdings) });
        })
        .catch(() => undefined);
    },
    busy: change.busy,
    grantMessage,
  };
}
