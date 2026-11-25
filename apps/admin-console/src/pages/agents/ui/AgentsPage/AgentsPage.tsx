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
import { LastAction } from '#/shared/ui/LastAction';
import { NarrowedNote } from '#/shared/ui/NarrowedNote';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';

const AREA = areaAt('agents');

// Drawn only as the skeleton's shape while the first page loads.
function columns(page: Page): readonly Column<AgentInstance>[] {
  const { columns: words } = page.text;
  return [
    { id: 'agent', header: words.agent, isRowHeader: true, cell: (run) => run.agentClient },
    { id: 'state', header: words.state, cell: (run) => run.state },
    { id: 'owner', header: words.actsFor, cell: (run) => run.owner },
    { id: 'expires', header: words.expires, secondary: true, cell: (run) => run.expiresAt },
  ];
}

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
        columns={columns(page)}
        rowKey={(run) => run.id}
        capability="manage-sessions"
        nothingYet={page.text.nothingYet}
        notice={
          <LastAction label={page.text.lastRevoke} count={page.last.count}>
            {page.last.text}
          </LastAction>
        }
        renderRows={() => <AgentTree tenant={tenant} page={page} />}
      />
      {dialog === null ? null : (
        <ConfirmDialog
          isOpen
          title={dialog.title}
          consequence={<span aria-live="polite">{dialog.consequence}</span>}
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
