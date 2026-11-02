import type { Client, ClientScope } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/entities/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord';
import { useScopeChanges, useScopePicker } from '#/features/clients/repository/useClientScopes';
import { scopesFixed } from '#/features/clients/services/blocks';
import { canChange, type Reach } from '#/features/clients/services/ceiling';
import { ceilingRefused } from '#/features/clients/services/refusal';
import {
  alreadyAssigned,
  moreScopes,
  scopeCount,
  scopeFailureText,
  SCOPES_CAPABILITY,
  SCOPES_PAGE,
  shownScopes,
} from '#/features/clients/services/scopes';
import { lacking } from '#/shared/services/access';
import type { AdminCapability } from '#/shared/services/principal';
import type { PickerState } from '#/shared/services/picker';
import { useAssignmentFlow, type Counterpart } from '#/shared/use-cases/useAssignmentFlow';
import { assignedText, assignmentOf, unassignedText } from '#/shared/services/assignment';

type Assigned = Client['scopes'][number];

export interface ClientScopes {
  // Whether assigning and removing are offered: the caller holds what they
  // need, and the client's service account is within its reach.
  offered: boolean;
  // What the caller lacks for them, said on the page.
  needs: readonly AdminCapability[];
  // Why scopes cannot be removed from this client, or null.
  fixed: string | null;
  count: string;
  shown: readonly Assigned[];
  more: number;
  showMore: () => void;
  picker: PickerState<ClientScope>;
  unavailableOf: (scope: ClientScope) => string | null;
  chosen: ClientScope | null;
  choose: (ids: readonly string[]) => void;
  assignment: string;
  setAssignment: (value: string) => void;
  // The scope whose change is in flight.
  working: string | null;
  // What the last change said when it did not go through.
  message: string | null;
  assign: () => Promise<boolean>;
  change: (scope: Assigned, assignment: string) => Promise<boolean>;
  remove: (scope: Assigned) => Promise<boolean>;
}

export function useClientScopeAssignment({
  tenant,
  client,
  reach,
}: {
  tenant: string;
  client: Client;
  reach: Reach;
}): ClientScopes {
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  const changes = useScopeChanges(tenant, client.id);
  const picker = useScopePicker(tenant);
  const needs = lacking(useAuthority(tenant), [SCOPES_CAPABILITY]);
  const [page, setPage] = useState(SCOPES_PAGE);
  const flow = useAssignmentFlow({
    refusal,
    capability: SCOPES_CAPABILITY,
    failureText: scopeFailureText,
    onRefused: (failure) => {
      if (ceilingRefused(failure)) reread();
    },
  });

  const assignScope = (scope: Counterpart, chosenAssignment: string) =>
    flow.perform(
      scope,
      'assigned',
      () => changes.assign.run({ scopeId: scope.id, assignment: assignmentOf(chosenAssignment) }),
      assignedText(scope.name, client.name, assignmentOf(chosenAssignment)),
    );

  const chosen = picker.options.find((scope) => scope.id === flow.chosenId) ?? null;
  return {
    offered: canChange(reach, needs),
    needs,
    fixed: scopesFixed(client),
    count: scopeCount(client.scopes.length),
    shown: shownScopes(client.scopes, page),
    more: moreScopes(client.scopes, page),
    showMore: () => {
      setPage((was) => was + SCOPES_PAGE);
    },
    picker,
    unavailableOf: (scope) => alreadyAssigned(scope, client.scopes),
    chosen,
    choose: flow.choose,
    assignment: flow.assignment,
    setAssignment: flow.setAssignment,
    working: flow.working,
    message: flow.message,
    assign: () => flow.assignChosen(chosen, (scope) => assignScope(scope, flow.assignment)),
    change: (scope, next) => assignScope(scope, next),
    remove: (scope) =>
      flow.perform(
        scope,
        'unassigned',
        () => changes.unassign.run({ scopeId: scope.id }),
        unassignedText(scope.name, client.name),
      ),
  };
}
