import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { AgentApproval } from '#/pages/agents/types/agent';
import {
  useApprovalsTitle,
  useAgentApprovalsPage,
  type AgentApprovalsPage as Page,
} from '#/pages/agents/use-cases/useAgentApprovalsPage';
import { OwnerLink } from '#/pages/agents/ui/OwnerLink';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/agents/ui/AgentApprovalsPage/AgentApprovalsPage.module.css';

const AREA = areaAt('agents');

function columns(page: Page): readonly Column<AgentApproval>[] {
  return [
    {
      id: 'summary',
      header: page.text.columns.summary,
      isRowHeader: true,
      cell: (approval) => (
        <span className={styles.summary}>
          <span>{approval.summary}</span>
          <code className={styles.kind}>{approval.kind}</code>
        </span>
      ),
    },
    {
      id: 'agent',
      header: page.text.columns.agent,
      cell: (approval) => <code className={styles.kind}>{approval.agentClient}</code>,
    },
    {
      id: 'owner',
      header: page.text.columns.owner,
      cell: (approval) => {
        const name = page.say.ownerName(approval.owner, approval.ownerUsername);
        return (
          <OwnerLink
            id={approval.owner}
            name={approval.ownerUsername}
            href={page.ownerLink?.(approval.owner)}
            linkLabel={page.say.ownerLink(name)}
            copyLabel={page.text.copy.owner}
          />
        );
      },
    },
    {
      id: 'state',
      header: page.text.columns.state,
      cell: (approval) => (
        <span className={styles.state}>
          <StatusTag tone={page.say.tone(approval.state)}>{approval.state}</StatusTag>
          <span>{page.say.decision(approval)}</span>
        </span>
      ),
    },
    {
      id: 'created_at',
      header: page.text.columns.asked,
      cell: (approval) => <Timestamp value={approval.createdAt} />,
    },
    {
      id: 'expires_at',
      header: page.text.columns.expires,
      secondary: true,
      cell: (approval) => <Timestamp value={approval.expiresAt} />,
    },
  ];
}

function List({ tenant }: { tenant: string }) {
  const page = useAgentApprovalsPage(tenant);
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title={page.text.title}
      description={page.text.rule}
      actions={<ButtonLink href={page.agentsHref}>{page.text.agents}</ButtonLink>}
      noun={page.text.noun}
      filters={
        <SelectField
          label={page.state.label}
          options={page.state.options}
          value={page.state.value}
          onChange={page.state.choose}
        />
      }
      columns={columns(page)}
      rowKey={(approval) => approval.id}
      capability="manage-sessions"
      nothingYet={page.text.nothingYet}
    />
  );
}

export function AgentApprovalsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={useApprovalsTitle()}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
