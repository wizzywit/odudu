import type { AgentInstance, LineageNode } from '#/pages/agents/types/agent';
import type { Read } from '#/shared/lib/services/read';
import { useAgentNode } from '#/pages/agents/use-cases/useAgentNode';
import type { AgentsPage } from '#/pages/agents/use-cases/useAgentsPage';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { OwnerLink } from '#/pages/agents/ui/OwnerLink';
import { InlineFailed } from '#/shared/ui/InlineFailed';
import { ListSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/agents/ui/AgentsPage/AgentTree.module.css';

function Details({
  run,
  detail,
  page,
}: {
  run: AgentInstance;
  detail: Read<AgentInstance>;
  page: AgentsPage;
}) {
  const facts = page.text.facts;
  if (detail.status === 'loading') {
    return <ListSkeleton label={page.say.reading(run)} items={1} />;
  }
  if (detail.status === 'failed') {
    return <InlineFailed message={facts.gone} retry={detail.retry} className={styles.empty} />;
  }
  const { data } = detail;
  return (
    <dl className={styles.details}>
      <dt>{facts.runId}</dt>
      <dd>
        <CopyValue label={page.text.copy.run} value={data.id} />
      </dd>
      <dt>{facts.parent}</dt>
      <dd>
        {data.parent === null ? (
          facts.none
        ) : (
          <CopyValue label={page.text.copy.parent} value={data.parent} />
        )}
      </dd>
      <dt>{facts.depth}</dt>
      <dd>{data.depth}</dd>
      <dt>{facts.scope}</dt>
      <dd>
        <code>{data.scope}</code>
      </dd>
      <dt>{facts.started}</dt>
      <dd>
        <Timestamp value={data.createdAt} />
      </dd>
    </dl>
  );
}

function Run({ tenant, node, page }: { tenant: string; node: LineageNode; page: AgentsPage }) {
  const { instance: run } = node;
  const open = useAgentNode(tenant, run.id);
  const { details, narrow } = page.text;
  const facts = page.text.facts;
  const budget = page.say.budget(run);
  const end = page.say.end(run);
  const name = page.say.ownerName(run.owner, run.ownerUsername);
  return (
    <li className={styles.node} aria-label={page.say.run(run)}>
      <div className={styles.row}>
        <code className={styles.client}>{run.agentClient}</code>
        <StatusTag tone={page.say.tone(run.state)}>{run.state}</StatusTag>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{facts.actsFor}</dt>
          <dd>
            <OwnerLink
              id={run.owner}
              name={run.ownerUsername}
              href={page.ownerLink?.(run.owner)}
              linkLabel={page.say.ownerLink(name)}
              copyLabel={page.text.copy.owner}
            />
          </dd>
        </div>
        {budget === null ? null : (
          <div>
            <dt>{facts.budget}</dt>
            <dd>{budget}</dd>
          </div>
        )}
        <div>
          <dt>{end.label}</dt>
          <dd>
            <Timestamp value={end.at} />
          </dd>
        </div>
      </dl>
      {node.detached && run.parent !== null ? (
        <p className={styles.detached}>{page.say.detached(run.parent)}</p>
      ) : null}
      <div className={styles.actions}>
        <Button
          size="small"
          variant="quiet"
          aria-expanded={open.open}
          onPress={open.toggle}
          aria-label={page.say.details(open.open, run)}
        >
          {open.open ? details.hide : details.show}
        </Button>
        <Button
          size="small"
          variant="quiet"
          aria-label={page.say.narrow(name)}
          onPress={() => {
            page.narrowTo(run.owner);
          }}
        >
          {narrow}
        </Button>
        {run.state === 'live' ? (
          <Button
            size="small"
            variant="danger"
            aria-label={page.say.revoke(run)}
            onPress={() => {
              page.revoke.ask(run);
            }}
          >
            {page.text.revoke}
          </Button>
        ) : null}
      </div>
      {open.open ? <Details run={run} detail={open.detail} page={page} /> : null}
      {node.children.length === 0 ? null : (
        <ul aria-label={page.say.tree(run)} className={styles.under}>
          {node.children.map((child) => (
            <Run key={child.instance.id} tenant={tenant} node={child} page={page} />
          ))}
        </ul>
      )}
    </li>
  );
}

// The loaded runs as trees. A page of the list holds at most MAX_LIMIT runs
// and "Load more" stops at the list's row budget, so the tree is bounded.
export function AgentTree({ tenant, page }: { tenant: string; page: AgentsPage }) {
  return (
    <ul aria-label={page.text.treeLabel} className={styles.tree}>
      {page.tree.map((node) => (
        <Run key={node.instance.id} tenant={tenant} node={node} page={page} />
      ))}
    </ul>
  );
}
