import type { Scope } from '#/entities/scope';
import type { ScopeClient } from '#/features/scopes/types/scopeClient';
import { useAuthority, useRefusal } from '#/entities/session';
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
} from '#/features/scopes/services/scopeClients';
import { type Client, useClientPicker } from '#/entities/client';
import { lacking } from '#/shared/services/access';
import type { PickerState } from '#/shared/services/picker';
import type { AdminCapability } from '#/shared/services/principal';
import {
  assignedText,
  ASSIGNMENT_RULE,
  ASSIGNMENTS,
  assignmentOf,
  type Counterpart,
  unassignedText,
  useAssignmentFlow,
} from '#/features/scope-assignment';

export interface ScopeClientsTab {
  list: ScopeClients;
  count: string;
  // The rule for what an assignment sends, with how many carry the scope.
  rule: string;
  // What an assignment can be.
  choices: typeof ASSIGNMENTS;
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
  scope: Scope;
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
    rule: `${ASSIGNMENT_RULE} ${clientsCount(list.rows.length, list.more)}`,
    choices: ASSIGNMENTS,
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
