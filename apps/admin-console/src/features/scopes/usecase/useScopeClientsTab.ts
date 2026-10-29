import type { Client, ClientScope, ScopeClient } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/features/session';
import {
  useClientAssignment,
  useScopeClients,
  type ScopeClients,
} from '#/features/scopes/repository/useScopeClients';
import {
  chosenClient,
  clientAssignmentFailure,
  clientsCount,
  clientsOffered,
} from '#/features/scopes/service';
import { useClientPicker } from '#/shared/repository/useClientPicker';
import { lacking } from '#/shared/service/access';
import type { PickerState } from '#/shared/service/picker';
import type { AdminCapability } from '#/shared/service/principal';
import { useAssignmentFlow, type Counterpart } from '#/shared/usecase/useAssignmentFlow';
import { assignedText, assignmentOf, unassignedText } from '#/shared/service/assignment';

export interface ScopeClientsTab {
  list: ScopeClients;
  count: string;
  // What the caller lacks to search for a client to assign.
  needs: readonly AdminCapability[];
  // Whether it may: whoami has answered and names nothing missing.
  offered: boolean;
  picker: PickerState<Client>;
  chosen: Client | null;
  choose: (ids: readonly string[]) => void;
  assignment: string;
  setAssignment: (value: string) => void;
  // The client whose change is in flight.
  working: string | null;
  // What the last change said when it did not go through.
  message: string | null;
  assign: () => Promise<boolean>;
  change: (row: ScopeClient, assignment: string) => Promise<boolean>;
  remove: (row: ScopeClient) => Promise<boolean>;
}

export function useScopeClientsTab({
  tenant,
  scope,
}: {
  tenant: string;
  scope: ClientScope;
}): ScopeClientsTab {
  const refusal = useRefusal(tenant);
  const list = useScopeClients(tenant, scope.id);
  const changes = useClientAssignment(tenant, scope.id);
  const authority = useAuthority(tenant);
  const needs = lacking(authority, ['manage-clients']);
  const offered = clientsOffered(authority !== undefined, needs);
  const picker = useClientPicker(tenant, offered);
  const flow = useAssignmentFlow({
    refusal,
    capability: 'manage-tenant',
    failureText: (failure, client, verb) =>
      clientAssignmentFailure(failure, scope.name, client, verb),
  });

  const assignTo = (client: Counterpart, chosenAssignment: string) =>
    flow.perform(
      client,
      'assigned',
      () => changes.assign.run({ clientId: client.id, assignment: assignmentOf(chosenAssignment) }),
      assignedText(scope.name, client.name, assignmentOf(chosenAssignment)),
    );

  const chosen = chosenClient(picker.options, flow.chosenId);
  return {
    list,
    count: clientsCount(list.rows.length, list.more),
    needs,
    offered,
    picker,
    chosen,
    choose: flow.choose,
    assignment: flow.assignment,
    setAssignment: flow.setAssignment,
    working: flow.working,
    message: flow.message,
    assign: () => flow.assignChosen(chosen, (client) => assignTo(client, flow.assignment)),
    change: (row, next) => assignTo({ id: row.id, name: row.name }, next),
    remove: (row) =>
      flow.perform(
        { id: row.id, name: row.name },
        'unassigned',
        () => changes.unassign.run({ clientId: row.id }),
        unassignedText(scope.name, row.name),
      ),
  };
}
