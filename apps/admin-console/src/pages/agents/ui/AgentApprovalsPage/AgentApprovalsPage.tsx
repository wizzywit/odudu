import { Link } from 'react-aria-components';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { AgentApproval } from '#/pages/agents/types/agent';
import {
  useAgentApprovalsPage,
  type AgentApprovalsPage as Page,
} from '#/pages/agents/use-cases/useAgentApprovalsPage';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { CopyValue } from '#/shared/ui/CopyValue';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/agents/ui/AgentApprovalsPage/AgentApprovalsPage.module.css';

const AREA = areaAt('agents');
const TITLE = 'Agent approvals';

function Owner({ owner, page }: { owner: string; page: Page }) {
  const href = page.ownerLink?.(owner);
  if (href === undefined) return <CopyValue label="owner id" value={owner} short />;
  const short = page.say.short(owner);
  return (
    <Link href={href} className={styles.link ?? ''} aria-label={`Open the owner ${short}`}>
      {short}
    </Link>
  );
}

function columns(page: Page): readonly Column<AgentApproval>[] {
  return [
    {
      id: 'summary',
      header: 'Asked to approve',
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
      header: 'Agent',
      cell: (approval) => <code className={styles.kind}>{approval.agentClient}</code>,
    },
    {
      id: 'owner',
      header: 'For',
      cell: (approval) => <Owner owner={approval.owner} page={page} />,
    },
    {
      id: 'state',
      header: 'State',
      cell: (approval) => (
        <span className={styles.state}>
          <StatusTag tone={page.say.tone(approval.state)}>{approval.state}</StatusTag>
          <span>{page.say.decision(approval)}</span>
        </span>
      ),
    },
    {
      id: 'created_at',
      header: 'Asked',
      cell: (approval) => <Timestamp value={approval.createdAt} />,
    },
    {
      id: 'expires_at',
      header: 'Expires',
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
      title={TITLE}
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
    <AreaGate tenant={tenant} area={AREA} title={TITLE}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
