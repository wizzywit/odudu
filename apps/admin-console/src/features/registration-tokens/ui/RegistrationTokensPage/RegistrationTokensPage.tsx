import type { RegistrationToken } from '@odudu/contracts/admin';
import { AreaGate } from '#/widgets/shell';
import {
  useRegistrationTokensPage,
  useTokensArea,
  type RegistrationTokensPage as Page,
} from '#/features/registration-tokens/use-cases/useRegistrationTokensPage';
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
import styles from '#/features/registration-tokens/ui/RegistrationTokensPage/RegistrationTokensPage.module.css';

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
          aria-label={page.revokeLabel(token)}
          onPress={() => {
            page.ask(token);
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
      <CreationForm submit={page.mint}>
        <FieldGrid>
          <GridCell>
            <NumberWithUnitField
              label={mint.usesLabel}
              description={mint.usesDescription}
              unit={mint.usesUnit}
              value={page.uses}
              error={page.errors.uses}
              onChange={page.editUses}
            />
          </GridCell>
          <GridCell>
            <NumberWithUnitField
              label={mint.lifetimeLabel}
              description={mint.lifetimeDescription}
              unit={mint.lifetimeUnit}
              value={page.lifetime}
              error={page.errors.ttl_seconds}
              onChange={page.editLifetime}
            />
          </GridCell>
        </FieldGrid>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={page.minting}>
            {page.minting ? mint.minting : mint.submit}
          </Button>
        </div>
        <LiveMessage label={mint.last}>{page.message}</LiveMessage>
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
          <LastAction label={words.lastRevoke} count={page.revoked}>
            {page.notice}
          </LastAction>
        }
      />
      <SecretDialog
        secret={page.secret}
        title={words.secret.title}
        label={words.secret.label}
        onClose={page.closeSecret}
      >
        {words.secret.note}
      </SecretDialog>
      <ConfirmDialog
        isOpen={page.revoking !== null}
        title={words.revoke.title}
        consequence={page.consequence}
        confirmLabel={words.revoke.confirm}
        tone="danger"
        busy={page.revokeBusy}
        problem={page.revokeProblem}
        onConfirm={() => {
          page.confirm().catch(() => undefined);
        }}
        onCancel={page.cancel}
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
