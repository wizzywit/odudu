import type { RegistrationToken } from '@odudu/contracts/admin';
import { AreaGate } from '#/widgets/shell';
import {
  useRegistrationTokensPage,
  useTokensArea,
  type RegistrationTokensPage as Page,
} from '#/pages/registration-tokens/use-cases/useRegistrationTokensPage';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import type { Column } from '#/shared/ui/DataTable';
import { NumberWithUnitField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { SecretDialog } from '#/shared/ui/SecretDialog';
import { Timestamp } from '#/shared/ui/Timestamp';
import { CreationForm } from '#/shared/ui/CreationForm';
import { LiveMessage } from '#/shared/ui/Message';
import { LastAction } from '#/shared/ui/LastAction';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/pages/registration-tokens/ui/RegistrationTokensPage/RegistrationTokensPage.module.css';

function columns(page: Page): readonly Column<RegistrationToken>[] {
  const { columns: header } = page.words;
  return [
    {
      id: 'id',
      header: header.token,
      isRowHeader: true,
      cell: (token) => <code className={styles.id}>{token.id}</code>,
    },
    { id: 'remaining_uses', header: header.usesLeft, cell: (token) => token.remaining_uses },
    {
      id: 'created_at',
      header: header.minted,
      secondary: true,
      cell: (token) => <Timestamp value={token.created_at} />,
    },
    {
      id: 'expires_at',
      header: header.expires,
      cell: (token) => <Timestamp value={token.expires_at} />,
    },
    {
      id: 'revoke',
      header: header.revoke,
      cell: (token) => (
        <Button
          size="small"
          variant="quiet"
          aria-label={page.revoke.label(token.id)}
          onPress={() => {
            page.revoke.ask(token);
          }}
        >
          {header.revoke}
        </Button>
      ),
    },
  ];
}

function Mint({ page }: { page: Page }) {
  const { mint } = page.words;
  return (
    <Panel title={mint.title}>
      <p className={recordTab.rule}>{mint.rule}</p>
      <CreationForm submit={page.mint.start}>
        <FieldGrid>
          <GridCell>
            <NumberWithUnitField
              label={mint.usesLabel}
              description={mint.usesDescription}
              unit={mint.usesUnit}
              value={page.mint.uses}
              error={page.mint.errors.uses}
              onChange={page.mint.editUses}
            />
          </GridCell>
          <GridCell>
            <NumberWithUnitField
              label={mint.lifetimeLabel}
              description={mint.lifetimeDescription}
              unit={mint.lifetimeUnit}
              value={page.mint.lifetime}
              error={page.mint.errors.ttl_seconds}
              onChange={page.mint.editLifetime}
            />
          </GridCell>
        </FieldGrid>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={page.mint.busy}>
            {page.mint.busy ? mint.minting : mint.submit}
          </Button>
        </div>
        <LiveMessage label={mint.last}>{page.mint.message}</LiveMessage>
      </CreationForm>
    </Panel>
  );
}

function List({ tenant }: { tenant: string }) {
  const page = useRegistrationTokensPage(tenant);
  const { words } = page;
  return (
    <>
      <ResourceListPage
        list={page.list}
        kicker={tenant}
        title={page.title}
        description={words.description}
        lead={<Mint page={page} />}
        noun={words.noun}
        columns={columns(page)}
        rowKey={(token) => token.id}
        capability="manage-clients"
        nothingYet={words.nothingYet}
        notice={
          <LastAction label={words.lastRevoke} count={page.revoke.count}>
            {page.revoke.notice}
          </LastAction>
        }
      />
      <SecretDialog
        secret={page.mint.secret}
        title={words.secret.title}
        label={words.secret.label}
        onClose={page.mint.closeSecret}
      >
        {words.secret.note}
      </SecretDialog>
      <ConfirmDialog
        isOpen={page.revoke.asked !== null}
        title={words.revoke.title}
        consequence={page.revoke.consequence}
        confirmLabel={words.revoke.confirm}
        tone="danger"
        busy={page.revoke.busy}
        problem={page.revoke.problem}
        onConfirm={() => {
          page.revoke.confirm().catch(() => undefined);
        }}
        onCancel={page.revoke.cancel}
      />
    </>
  );
}

export function RegistrationTokensPage({ tenant }: { tenant: string }) {
  const { area, title } = useTokensArea();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
