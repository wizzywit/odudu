import { Link } from 'react-aria-components';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import type { ActivityConversation } from '#/pages/assistant-activity/types/activity';
import {
  useActivityPage,
  type ActivityPage as Page,
  type TextField as TextFilterState,
} from '#/pages/assistant-activity/use-cases/useActivityPage';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField, TextField } from '#/shared/ui/Field';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { groupedNumber } from '#/shared/lib/services/format';
import styles from '#/pages/assistant-activity/ui/AssistantActivityPage/AssistantActivityPage.module.css';

const AREA = areaAt('assistant-activity');

function Conversation({ row, page }: { row: ActivityConversation; page: Page }) {
  const title = page.say.title(row);
  return (
    <span className={styles.stack}>
      <Link
        href={page.replayAt(row.id)}
        className={styles.name ?? ''}
        aria-label={page.say.open(title)}
      >
        {title}
      </Link>
      <span className={styles.muted}>
        {row.profile} · {row.mode}
      </span>
      <CopyValue label={page.words.copyId} value={row.id} short />
    </span>
  );
}

function Person({ row, page }: { row: ActivityConversation; page: Page }) {
  const name = page.say.person(row);
  const href = page.personLink?.(row.person);
  return (
    <span className={styles.stack}>
      {href === undefined ? (
        <span title={row.person}>{name}</span>
      ) : (
        <Link href={href} className={styles.plain ?? ''} aria-label={page.words.openSubject(name)}>
          {name}
        </Link>
      )}
      <Button
        size="small"
        variant="quiet"
        aria-label={page.say.onlyPerson(name)}
        onPress={() => {
          page.onlyPerson(row.person);
        }}
      >
        {page.words.onlyThisPerson}
      </Button>
    </span>
  );
}

function Kept({ row, page }: { row: ActivityConversation; page: Page }) {
  const { kept } = page.words;
  return (
    <span className={styles.stack}>
      <span>{page.say.changes(row.approvals)}</span>
      {row.reportedAt === null ? <span className={styles.muted}>{kept.no}</span> : null}
      {row.reportedAt === null ? null : <StatusTag tone="active">{kept.reported}</StatusTag>}
      {row.reportOld ? <span className={styles.muted}>{kept.old}</span> : null}
    </span>
  );
}

function columns(page: Page): readonly Column<ActivityConversation>[] {
  const words = page.words.columns;
  return [
    {
      id: 'conversation',
      header: words.conversation,
      isRowHeader: true,
      cell: (row) => <Conversation row={row} page={page} />,
    },
    { id: 'person', header: words.person, cell: (row) => <Person row={row} page={page} /> },
    {
      id: 'last_active_at',
      header: words.lastActive,
      cell: (row) => <Timestamp value={row.lastActiveAt} />,
    },
    {
      id: 'activity',
      header: words.activity,
      secondary: true,
      cell: (row) => (
        <span className={styles.stack}>
          <span>{page.say.answers(row)}</span>
          <span>{groupedNumber(page.say.total(row.tokens))} tokens</span>
          <span className={styles.muted}>{page.say.breakdown(row.tokens)}</span>
          <span className={styles.muted}>{page.say.tools(row.tools)}</span>
        </span>
      ),
    },
    {
      id: 'outcome',
      header: words.outcome,
      cell: (row) => (
        <StatusTag tone={page.say.tone(row.stopReason)}>{page.say.stop(row.stopReason)}</StatusTag>
      ),
    },
    {
      id: 'kept',
      header: words.kept,
      secondary: true,
      cell: (row) => <Kept row={row} page={page} />,
    },
  ];
}

function Typed({ field, mono }: { field: TextFilterState; mono: boolean }) {
  return (
    <TextField
      label={field.label}
      description={field.hint}
      error={field.error}
      value={field.value}
      mono={mono}
      onChange={field.change}
      onBlur={field.commit}
      onEnter={field.commit}
    />
  );
}

function Filters({ page }: { page: Page }) {
  return (
    <>
      <SelectField
        label={page.kind.label}
        options={page.kind.options}
        value={page.kind.value}
        onChange={page.kind.choose}
      />
      <SelectField
        label={page.outcome.label}
        options={page.outcome.options}
        value={page.outcome.value}
        onChange={page.outcome.choose}
      />
      <Typed field={page.text.tool} mono />
      <Typed field={page.text.person} mono />
      <Typed field={page.text.conversation} mono />
    </>
  );
}

function List({ tenant }: { tenant: string }) {
  const page = useActivityPage(tenant);
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title={AREA.label}
      description={page.words.rule}
      noun={page.words.noun}
      filters={<Filters page={page} />}
      columns={columns(page)}
      rowKey={(row) => row.id}
      capability="read-assistant-activity"
      nothingYet={page.words.nothingYet}
    />
  );
}

export function AssistantActivityPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
