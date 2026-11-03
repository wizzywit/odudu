import type { Scope } from '#/entities/scope';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useScopesList } from '#/features/scopes/use-cases/useScopesList';
import { RestoreScopes } from '#/features/scopes/ui/ScopesPage/RestoreScopes';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/features/scopes/ui/ScopesPage/ScopesPage.module.css';
import { NAME_SEARCH } from '#/shared/services/filters';

const AREA = areaAt('scopes');

const COLUMNS: readonly Column<Scope>[] = [
  {
    id: 'name',
    header: 'Scope',
    isRowHeader: true,
    cell: (scope) => <code className={styles.name}>{scope.name}</code>,
  },
  { id: 'description', header: 'Description', cell: (scope) => scope.description ?? '—' },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (scope) => <Timestamp value={scope.created_at} />,
  },
];

function List({ tenant }: { tenant: string }) {
  const page = useScopesList(tenant);
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title={AREA.label}
      description="A scope is what a client asks to be let do, and what a token says it was granted. A search matches the start of a name."
      actions={
        <>
          <RestoreScopes tenant={tenant} />
          <ButtonLink href={page.createHref} variant="primary">
            Create a scope
          </ButtonLink>
        </>
      }
      noun={{ one: 'scope', other: 'scopes' }}
      searchFields={NAME_SEARCH}
      columns={COLUMNS}
      rowKey={(scope) => scope.id}
      onRowAction={page.open}
      capability="manage-tenant"
      nothingYet="A scope names something a client may be let do, such as reading invoices."
    />
  );
}

export function ScopesPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
