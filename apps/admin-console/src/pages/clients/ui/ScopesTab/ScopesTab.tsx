import type { Client } from '#/entities/client';
import type { Scope } from '#/entities/scope';
import { type ServiceAccountReach } from '#/pages/clients/services/ceiling';
import {
  useClientScopeAssignment,
  type ClientScopes,
} from '#/pages/clients/use-cases/useClientScopeAssignment';
import { Evaluate } from '#/pages/clients/ui/Evaluate';
import { AssignedList, AssignedRow, AssignPanel } from '#/features/scope-assignment';
import { Button } from '#/shared/ui/Button';
import { Problem } from '#/shared/ui/Message';
import { Panel, useHeadingFocus } from '#/shared/ui/Panel';
import { Picker } from '#/shared/ui/Picker';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import { recordTab } from '#/shared/ui/RecordTab';

function Assigned({ client, page }: { client: Client; page: ClientScopes }) {
  const { heading, afterRemoval } = useHeadingFocus();
  return (
    <Panel title={page.assignedHeading} headingRef={heading}>
      <p className={recordTab.rule}>{page.rule}</p>
      {page.fixed === null ? null : <p className={recordTab.rule}>{page.fixed}</p>}
      {page.shown.length === 0 ? (
        <p className={recordTab.text}>{page.noScopes}</p>
      ) : (
        <AssignedList label={`Scopes assigned to ${client.name}`}>
          {page.shown.map((scope) => (
            <AssignedRow
              key={scope.id}
              name={<code>{scope.name}</code>}
              choices={page.choices}
              assignment={
                page.offered
                  ? {
                      label: `Assignment of ${scope.name}`,
                      value: scope.assignment,
                      onChange: (value) => page.change(scope, value),
                    }
                  : scope.assignment
              }
              working={page.working !== null}
              remove={
                page.offered && page.fixed === null
                  ? {
                      verb: 'Remove',
                      target: scope.name,
                      onRemove: () => afterRemoval(page.remove(scope)),
                    }
                  : null
              }
            />
          ))}
        </AssignedList>
      )}
      {page.more > 0 ? (
        <div className={recordTab.actions}>
          <Button size="small" onPress={page.showMore}>
            {`Show ${String(page.more)} more`}
          </Button>
        </div>
      ) : null}
      <Problem>{page.message}</Problem>
    </Panel>
  );
}

function Assign({ page }: { page: ClientScopes }) {
  return (
    <AssignPanel
      title={page.assignHeading}
      assignment={page.assignment}
      choices={page.choices}
      onAssignment={page.setAssignment}
      label={page.assignLabel}
      disabled={page.chosen === null || page.working !== null}
      onAssign={page.assign}
    >
      <Picker<Scope>
        label={page.pickerLabel}
        noun={{ one: 'scope', other: 'scopes' }}
        picker={page.picker}
        idOf={(scope) => scope.id}
        nameOf={(scope) => scope.name}
        detailOf={(scope) => scope.description ?? ''}
        unavailableOf={page.unavailableOf}
        capability="manage-tenant"
        selected={page.chosen === null ? [] : [page.chosen.id]}
        selectionMode="single"
        onChange={page.choose}
      />
    </AssignPanel>
  );
}

export function ScopesTab({
  tenant,
  client,
  reach,
}: {
  tenant: string;
  client: Client;
  reach: ServiceAccountReach;
}) {
  const page = useClientScopeAssignment({ tenant, client, reach });
  return (
    <div className={recordTab.tab}>
      {page.needs.length > 0 ? (
        <ViewOnlyNote noun="this client's scopes" needs={page.needs} />
      ) : null}
      <Assigned client={client} page={page} />
      {page.offered ? <Assign page={page} /> : null}
      <Evaluate tenant={tenant} client={client} />
    </div>
  );
}
