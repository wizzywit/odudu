import { AreaGate } from '#/widgets/shell';
import type { Challenge, ColumnId, DomainRow } from '#/pages/domains/services/rows';
import {
  useDomainsArea,
  useDomainsPage,
  type DomainsPage as Page,
} from '#/pages/domains/use-cases/useDomainsPage';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { CopyValue } from '#/shared/ui/CopyValue';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { TextField } from '#/shared/ui/Field';
import { LastAction } from '#/shared/ui/LastAction';
import { LiveMessage } from '#/shared/ui/Message';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Panel } from '#/shared/ui/Panel';
import { ReadGate } from '#/shared/ui/ReadGate';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import styles from '#/pages/domains/ui/DomainsPage/DomainsPage.module.css';

function columns(page: Page): readonly Column<DomainRow>[] {
  const { columns: header, ...labels } = page.words.list;
  const byId: Record<ColumnId, Column<DomainRow>> = {
    host: {
      id: 'host',
      header: header.host,
      isRowHeader: true,
      cell: ({ domain }) => <code className={styles.host}>{domain.host}</code>,
    },
    state: {
      id: 'state',
      header: header.state,
      cell: ({ tag }) => <StatusTag tone={tag.tone}>{tag.label}</StatusTag>,
    },
    use: { id: 'use', header: header.use, cell: ({ use }) => use ?? '—' },
    checked: {
      id: 'checked',
      header: header.checked,
      secondary: true,
      cell: ({ domain }) =>
        domain.last_checked_at === null ? '—' : <Timestamp value={domain.last_checked_at} />,
    },
    actions: {
      id: 'actions',
      header: header.actions,
      cell: (row) => (
        <div className={styles.actions}>
          {row.actions.map((action) => (
            <Button
              key={action}
              size="small"
              variant="quiet"
              aria-label={row.labels[action]}
              isDisabled={page.disabled(action)}
              onPress={() => {
                page.act(action, row.domain);
              }}
            >
              {labels[action]}
            </Button>
          ))}
        </div>
      ),
    },
  };
  return page.columns.map((id) => byId[id]);
}

function Register({ page }: { page: Page }) {
  const { register } = page.words;
  return (
    <Panel title={register.title}>
      <p className={styles.rule}>{register.rule}</p>
      <form
        noValidate
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          page.register.start();
        }}
      >
        <TextField
          label={register.hostLabel}
          description={register.hostDescription}
          value={page.register.host}
          error={page.register.error}
          onChange={page.register.edit}
          mono
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={page.register.busy}>
            {page.register.label}
          </Button>
        </div>
        <LiveMessage label={register.last}>{page.register.message}</LiveMessage>
      </form>
    </Panel>
  );
}

function ChallengeRecord({ challenge, page }: { challenge: Challenge; page: Page }) {
  const { challenge: words } = page.words;
  const { host, record } = challenge;
  return (
    <div className={styles.challenge}>
      <p className={styles.challengeHost}>{host}</p>
      <div className={styles.pair}>
        <span className={styles.pairLabel}>{words.name}</span>
        <CopyValue label={`TXT record name for ${host}`} value={record.name} />
      </div>
      <div className={styles.pair}>
        <span className={styles.pairLabel}>{words.value}</span>
        <CopyValue label={`TXT record value for ${host}`} value={record.value} />
      </div>
    </div>
  );
}

function Challenges({ page }: { page: Page }) {
  const { challenge } = page.words;
  if (page.challenges.length === 0) return null;
  return (
    <Panel title={challenge.title}>
      <p className={styles.rule}>{challenge.rule}</p>
      {page.challenges.map((each) => (
        <ChallengeRecord key={each.id} challenge={each} page={page} />
      ))}
    </Panel>
  );
}

function Switching({ page }: { page: Page }) {
  const { switching } = page.words;
  return (
    <Panel title={switching.title}>
      <p className={styles.rule}>{switching.sessions}</p>
      <p className={styles.rule}>{page.transition}</p>
      <p className={styles.rule}>{switching.passkeys}</p>
      <p className={styles.rule}>{switching.back}</p>
    </Panel>
  );
}

function Listed({ page }: { page: Page }) {
  const { list } = page.words;
  return (
    <Panel title={list.title}>
      <p className={styles.rule}>{page.address}</p>
      {page.rows.length === 0 ? (
        <EmptyState variant="nothing-yet" title="No domains">
          {list.nothingYet}
        </EmptyState>
      ) : (
        <DataTable
          label={list.label}
          columns={columns(page)}
          rows={page.rows}
          rowKey={({ domain }) => domain.id}
        />
      )}
      <LiveMessage label={page.words.challenge.lastVerify}>{page.verify.message}</LiveMessage>
      <LastAction label={page.words.lastAction} count={page.action.count}>
        {page.action.notice}
      </LastAction>
    </Panel>
  );
}

function SwitchDialog({ page }: { page: Page }) {
  const { action } = page;
  return (
    <ConfirmDialog
      {...action.dialog}
      busy={action.busy}
      problem={action.problem}
      held={action.held}
      onConfirm={() => {
        action.confirm().catch(() => undefined);
      }}
      onCancel={action.cancel}
    />
  );
}

function Domains({ tenant }: { tenant: string }) {
  const page = useDomainsPage(tenant);
  return (
    <>
      <PageHeader kicker={tenant} title={page.title} description={page.words.description} />
      <div className={styles.page}>
        {page.needs === null ? null : (
          <ViewOnlyNote noun="the domains" change={page.needs.change} needs={page.needs.needs} />
        )}
        <ReadGate
          read={page.record}
          label={page.words.list.loading}
          fields={2}
          failed={page.words.list.failed}
        >
          {() => (
            <>
              {page.needs === null ? <Register page={page} /> : null}
              <Challenges page={page} />
              <Listed page={page} />
              <Switching page={page} />
            </>
          )}
        </ReadGate>
      </div>
      <SwitchDialog page={page} />
    </>
  );
}

export function DomainsPage({ tenant }: { tenant: string }) {
  const { area, title } = useDomainsArea();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <Domains tenant={tenant} />
    </AreaGate>
  );
}
