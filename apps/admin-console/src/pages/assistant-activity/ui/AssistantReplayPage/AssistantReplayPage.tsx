import { useId } from 'react';
import { Link } from 'react-aria-components';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { Replay, ReplayApproval } from '#/pages/assistant-activity/types/activity';
import {
  useReplayPage,
  type ReplayPage as Page,
} from '#/pages/assistant-activity/use-cases/useReplayPage';
import { TurnCard } from '#/pages/assistant-activity/ui/TurnCard';
import { Button } from '#/shared/ui/Button';
import type { Column } from '#/shared/ui/DataTable';
import { DataTable } from '#/shared/ui/DataTable';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { Note } from '#/shared/ui/Note';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Panel } from '#/shared/ui/Panel';
import { Skeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/assistant-activity/ui/AssistantReplayPage/AssistantReplayPage.module.css';

const AREA = areaAt('assistant-activity');

function crumbs(page: Page) {
  return [{ label: page.words.back, href: page.backHref }, { label: page.words.title }];
}

function Facts({ replay, page }: { replay: Replay; page: Page }) {
  const href = page.personLink?.(replay.person);
  const name = replay.personName ?? replay.person;
  const { facts } = page.words;
  return (
    <dl className={styles.facts}>
      <div>
        <dt>{facts.person}</dt>
        <dd>
          {href === undefined ? (
            name
          ) : (
            <Link
              href={href}
              className={styles.link ?? ''}
              aria-label={page.words.openSubject(name)}
            >
              {name}
            </Link>
          )}
        </dd>
      </div>
      <div>
        <dt>{facts.profile}</dt>
        <dd>
          {replay.profile} · {replay.mode}
        </dd>
      </div>
      <div>
        <dt>{facts.started}</dt>
        <dd>
          <Timestamp value={replay.startedAt} />
        </dd>
      </div>
      <div>
        <dt>{facts.lastActive}</dt>
        <dd>
          <Timestamp value={replay.lastActiveAt} />
        </dd>
      </div>
    </dl>
  );
}

function approvalColumns(page: Page): readonly Column<ReplayApproval>[] {
  const words = page.words.approvalColumns;
  return [
    {
      id: 'change',
      header: words.change,
      isRowHeader: true,
      cell: (approval) => (
        <span className={styles.stack}>
          <span>{approval.title ?? approval.tool}</span>
          <code className={styles.code}>{approval.tool}</code>
        </span>
      ),
    },
    {
      id: 'target',
      header: words.target,
      cell: (approval) => approval.target ?? page.words.nothing,
    },
    {
      id: 'state',
      header: words.decision,
      cell: (approval) => (
        <StatusTag tone={page.approvalTone(approval.state)}>{approval.state}</StatusTag>
      ),
    },
    {
      id: 'decided_at',
      header: words.decided,
      cell: (approval) =>
        approval.decidedAt === null ? page.words.nothing : <Timestamp value={approval.decidedAt} />,
    },
  ];
}

function Asked({ replay, page }: { replay: Replay; page: Page }) {
  if (replay.asked.length === 0) return null;
  return (
    <Panel title={page.words.asked}>
      <ol className={styles.asked}>
        {replay.asked.map((message) => (
          <li key={`${message.at}:${message.text}`}>
            <span className={styles.muted}>
              <Timestamp value={message.at} />
            </span>
            <p className={styles.said}>{message.text}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Actions({ replay, page, lineId }: { replay: Replay; page: Page; lineId: string }) {
  const held = page.report.held(replay);
  return (
    <div className={styles.actions}>
      <Button variant="secondary" isDisabled={page.export.busy} onPress={page.export.run}>
        {page.export.label}
      </Button>
      <Button
        variant="secondary"
        isDisabled={held || page.report.busy}
        {...(page.report.line === null ? {} : { 'aria-describedby': lineId })}
        onPress={page.report.run}
      >
        {page.report.label(replay)}
      </Button>
    </div>
  );
}

function Body({ replay, page }: { replay: Replay; page: Page }) {
  const lineId = useId();
  const turns = page.turns(replay);
  const line = page.report.line;
  return (
    <>
      <PageHeader
        breadcrumb={crumbs(page)}
        title={page.words.title}
        description={`${page.report.explained} ${page.export.explained}`}
        actions={<Actions replay={replay} page={page} lineId={lineId} />}
      />
      <div className={styles.page}>
        {line === null ? null : (
          <p id={lineId} role="status" className={styles.line}>
            {line}
          </p>
        )}
        {replay.textVisible ? null : <Note>{page.words.withheld}</Note>}
        <Panel title={page.words.title}>
          <Facts replay={replay} page={page} />
        </Panel>
        <Asked replay={replay} page={page} />
        <Panel title={page.words.changes}>
          {replay.approvals.length === 0 ? (
            <p className={styles.none}>{page.words.noChanges}</p>
          ) : (
            <DataTable
              label={page.words.changes}
              columns={approvalColumns(page)}
              rows={replay.approvals}
              rowKey={(approval) => approval.id}
            />
          )}
        </Panel>
        <section className={styles.turns} aria-label={page.words.answers}>
          {replay.turnsOmitted === 0 ? null : (
            <p className={styles.muted}>{page.words.omitted(replay.turnsOmitted)}</p>
          )}
          {turns.map((turn) => (
            <TurnCard key={turn.id} turn={turn} page={page} />
          ))}
        </section>
      </div>
    </>
  );
}

function Replayed({ tenant, id }: { tenant: string; id: string }) {
  const page = useReplayPage(tenant, id);
  const { read } = page;
  if (read.status === 'loading') return <Skeleton label={page.words.loading} />;
  if (read.status === 'failed') {
    return (
      <>
        <PageHeader breadcrumb={crumbs(page)} title={page.words.title} />
        <LoadFailed title={page.words.failed} retry={read.retry} />
      </>
    );
  }
  return <Body replay={read.data} page={page} />;
}

export function AssistantReplayPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <Replayed tenant={tenant} id={id} />
    </AreaGate>
  );
}
