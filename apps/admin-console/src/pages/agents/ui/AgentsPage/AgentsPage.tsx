import type { ReactNode } from 'react';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { AgentInstance } from '#/pages/agents/types/agent';
import { AgentTree } from '#/pages/agents/ui/AgentsPage/AgentTree';
import { useAgentsPage, type AgentsPage as Page } from '#/pages/agents/use-cases/useAgentsPage';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { NarrowedNote } from '#/shared/ui/NarrowedNote';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';

const AREA = areaAt('agents');

// Drawn only as the skeleton's shape while the first page loads.
const COLUMNS: readonly Column<AgentInstance>[] = [
  { id: 'agent', header: 'Agent', isRowHeader: true, cell: (run) => run.agentClient },
  { id: 'state', header: 'State', cell: (run) => run.state },
  { id: 'owner', header: 'Acts for', cell: (run) => run.owner },
  { id: 'expires', header: 'Expires', secondary: true, cell: (run) => run.expiresAt },
];

function Filters({ page }: { page: Page }): ReactNode {
  return (
    <>
      <SelectField
        label={page.state.label}
        options={page.state.options}
        value={page.state.value}
        onChange={page.state.choose}
      />
      {page.owner === null ? null : (
        <NarrowedNote all={page.owner.all} onClear={page.owner.clear}>
          {page.owner.note}
        </NarrowedNote>
      )}
    </>
  );
}

function List({ tenant }: { tenant: string }) {
  const page = useAgentsPage(tenant);
  const { dialog } = page;
  return (
    <>
      <ResourceListPage
        list={page.list}
        kicker={tenant}
        title={AREA.label}
        description={page.text.rule}
        actions={<ButtonLink href={page.approvalsHref}>{page.text.approvals}</ButtonLink>}
        noun={page.text.noun}
        filters={<Filters page={page} />}
        columns={COLUMNS}
        rowKey={(run) => run.id}
        capability="manage-sessions"
        nothingYet={page.text.nothingYet}
        renderRows={() => <AgentTree tenant={tenant} page={page} />}
      />
      {dialog === null ? null : (
        <ConfirmDialog
          isOpen
          title={dialog.title}
          consequence={dialog.consequence}
          confirmLabel={page.text.revokeConfirm}
          tone="danger"
          held={dialog.held}
          busy={page.revoke.busy}
          problem={
            page.revoke.problem ??
            (page.retry === null ? null : (
              <Button size="small" onPress={page.retry.run}>
                {page.retry.label}
              </Button>
            ))
          }
          onConfirm={page.revoke.confirm}
          onCancel={page.revoke.cancel}
        />
      )}
    </>
  );
}

export function AgentsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
