import type { Scope } from '#/entities/scope';
import {
  useScopeClientsTab,
  type ScopeClientsTab,
} from '#/features/scopes/use-cases/useScopeClientsTab';
import { AssignedList, AssignedRow, AssignPanel } from '#/features/scope-assignment';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ClientPicker } from '#/entities/client';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore } from '#/shared/ui/LoadMore';
import { Problem } from '#/shared/ui/Message';
import { Panel, useHeadingFocus } from '#/shared/ui/Panel';
import { ListSkeleton } from '#/shared/ui/Skeleton';
import { recordTab } from '#/shared/ui/RecordTab';

function Carriers({ scope, page }: { scope: Scope; page: ScopeClientsTab }) {
  const { heading, afterRemoval } = useHeadingFocus();
  const { list } = page;
  const label = `Clients carrying ${scope.name}`;
  const body = (
    <ListGate
      list={list}
      loading={<ListSkeleton label="Loading the clients" />}
      failed="The clients could not be loaded"
    >
      {() =>
        list.rows.length === 0 ? (
          <p className={recordTab.text}>{`No client carries ${scope.name}.`}</p>
        ) : (
          <AssignedList label={label}>
            {list.rows.map((row) => (
              <AssignedRow
                key={row.id}
                choices={page.choices}
                name={
                  <span>
                    {row.name} <code>{row.client_id}</code>
                  </span>
                }
                assignment={{
                  label: `Assignment for ${row.name}`,
                  value: row.assignment,
                  onChange: (value) => page.change(row, value),
                }}
                working={page.working !== null}
                remove={{
                  verb: 'Unassign',
                  target: row.name,
                  onRemove: () => afterRemoval(page.remove(row)),
                }}
              />
            ))}
          </AssignedList>
        )
      }
    </ListGate>
  );
  return (
    <Panel title={label} headingRef={heading}>
      <p className={recordTab.rule}>{page.rule}</p>
      {body}
      {list.more ? (
        <div className={recordTab.actions}>
          <LoadMore
            noun="clients"
            loading={list.loadingMore}
            limited={list.loadLimited}
            onPress={list.loadMore}
          />
        </div>
      ) : null}
      {list.loadMoreFailed ? (
        <p role="alert" className={recordTab.message}>
          More clients could not be loaded. The ones above are still shown.
        </p>
      ) : null}
      <Problem>{page.message}</Problem>
    </Panel>
  );
}

function Assign({ page }: { page: ScopeClientsTab }) {
  return (
    <AssignPanel
      title="Assign to a client"
      assignment={page.assignment}
      choices={page.choices}
      onAssignment={page.setAssignment}
      label={page.chosen === null ? 'Assign to a client' : `Assign to ${page.chosen.name}`}
      disabled={page.chosen === null || page.working !== null}
      onAssign={page.assign}
    >
      <ClientPicker
        label="Client to assign"
        picker={page.picker}
        selected={page.chosen === null ? [] : [page.chosen.id]}
        selectionMode="single"
        onChange={page.choose}
      />
    </AssignPanel>
  );
}

export function ClientsTab({ tenant, scope }: { tenant: string; scope: Scope }) {
  const page = useScopeClientsTab({ tenant, scope });
  return (
    <div className={recordTab.tab}>
      <Carriers scope={scope} page={page} />
      {page.offered ? <Assign page={page} /> : null}
      {page.needs.length > 0 ? (
        <CapabilityNote capability="manage-clients">Choosing a client to assign</CapabilityNote>
      ) : null}
    </div>
  );
}
