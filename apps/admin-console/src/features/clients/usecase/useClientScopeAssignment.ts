import type { Client, ClientScope } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import { useScopeChanges, useScopePicker } from '#/features/clients/repository/useClientScopes.ts';
import {
  alreadyAssigned,
  assignedText,
  assignmentOf,
  canChange,
  ceilingRefused,
  moreScopes,
  scopeCount,
  scopeFailureText,
  SCOPES_CAPABILITY,
  SCOPES_PAGE,
  scopesFixed,
  shownScopes,
  unassignedText,
  type Reach,
} from '#/features/clients/service';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { lacking } from '#/shared/service/access.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import { lastChosen, type PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';

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
  const push = useToasts((queue) => queue.push);
  const changes = useScopeChanges(tenant, client.id);
  const picker = useScopePicker(tenant);
  const needs = lacking(useAuthority(tenant), [SCOPES_CAPABILITY]);
  const [page, setPage] = useState(SCOPES_PAGE);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState('default');
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const failed = (failure: GatewayFailure, scope: string, verb: 'assigned' | 'unassigned') => {
    refusal.report(failure, SCOPES_CAPABILITY);
    if (ceilingRefused(failure)) reread();
    setMessage(scopeFailureText(failure, scope, verb));
  };

  // One change at a time: what it said is shown, and whether it went is answered.
  const perform = (
    scope: { id: string; name: string },
    verb: 'assigned' | 'unassigned',
    run: () => Promise<GatewayResult<unknown>>,
    done: string,
  ): Promise<boolean> => {
    if (working !== null) return Promise.resolve(false);
    setWorking(scope.id);
    setMessage(null);
    return run()
      .then((result): boolean => {
        if (!result.ok) {
          failed(result, scope.name, verb);
          return false;
        }
        push({ tone: 'success', message: done });
        return true;
      })
      .catch((): boolean => {
        failed({ ok: false, kind: 'defect' }, scope.name, verb);
        return false;
      })
      .finally(() => {
        setWorking(null);
      });
  };

  const assignScope = (scope: { id: string; name: string }, chosenAssignment: string) =>
    perform(
      scope,
      'assigned',
      () => changes.assign.run({ scopeId: scope.id, assignment: assignmentOf(chosenAssignment) }),
      assignedText(client.name, scope.name, assignmentOf(chosenAssignment)),
    );

  const chosen = picker.options.find((scope) => scope.id === chosenId) ?? null;
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
    choose: (ids) => {
      setChosenId(lastChosen(ids));
    },
    assignment,
    setAssignment,
    working,
    message,
    assign: async () => {
      if (chosen === null) return false;
      const done = await assignScope(chosen, assignment);
      if (done) setChosenId(null);
      return done;
    },
    change: (scope, next) => assignScope(scope, next),
    remove: (scope) =>
      perform(
        scope,
        'unassigned',
        () => changes.unassign.run({ scopeId: scope.id }),
        unassignedText(client.name, scope.name),
      ),
  };
}
