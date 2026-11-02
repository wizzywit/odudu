import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useAdministratorGrant } from '#/features/system-admins/repository/useAdministratorChange';
import { usePickerHolders } from '#/features/system-admins/repository/usePickerHolders';
import { useSubjectPicker } from '#/shared/repository/useSubjectPicker';
import { administratorsAccess } from '#/features/system-admins/services/access';
import { grantedText, grantFailureText } from '#/features/system-admins/services/grant';
import {
  choosable,
  pickerUnavailable,
  subjectName,
} from '#/features/system-admins/services/picker';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/tenants';
import { useToast } from '#/shared/repository/useToasts';
import type { Change } from '#/shared/services/access';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  holdingsProblem,
  TENANT_ADMIN,
} from '#/shared/services/administrators';
import { holdingOptions, holdingsIn, type HoldingOption } from '#/shared/services/capabilities';
import { inOrderOf } from '#/shared/services/ids';
import type { PickerState } from '#/shared/services/picker';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/services/principal';

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
  const picker = useSubjectPicker(SYSTEM_TENANT);
  const change = useAdministratorGrant();
  const begin = useBeginAdministrator(SYSTEM_TENANT, 'existing');
  const toast = useToast();
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
          toast.succeeded(grantedText(name, holdings));
        })
        .catch(() => undefined);
    },
    busy: change.busy,
    grantMessage,
  };
}
