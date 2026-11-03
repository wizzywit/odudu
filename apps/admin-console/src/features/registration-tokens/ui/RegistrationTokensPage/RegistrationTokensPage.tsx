import type { RegistrationToken } from '@odudu/contracts/admin';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { NOTHING_YET, NOUN, TOKENS_RULE } from '#/features/registration-tokens/services/page';
import {
  useRegistrationTokensPage,
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

const AREA = areaAt('registration-tokens');

function columns(page: Page): readonly Column<RegistrationToken>[] {
  return [
    {
      id: 'id',
      header: 'Token',
      isRowHeader: true,
      cell: (token) => <code className={styles.id}>{token.id}</code>,
    },
    { id: 'remaining_uses', header: 'Uses left', cell: (token) => token.remaining_uses },
    {
      id: 'created_at',
      header: 'Minted',
      secondary: true,
      cell: (token) => <Timestamp value={token.created_at} />,
    },
    {
      id: 'expires_at',
      header: 'Expires',
      cell: (token) => <Timestamp value={token.expires_at} />,
    },
    {
      id: 'revoke',
      header: 'Revoke',
      cell: (token) => (
        <Button
          size="small"
          variant="quiet"
          aria-label={`Revoke ${token.id}`}
          onPress={() => {
            page.ask(token);
          }}
        >
          Revoke
        </Button>
      ),
    },
  ];
}

function Mint({ page }: { page: Page }) {
  return (
    <Panel title="Mint a registration token">
      <p className={recordTab.rule}>{TOKENS_RULE}</p>
      <CreationForm submit={page.mint}>
        <FieldGrid>
          <GridCell>
            <NumberWithUnitField
              label="Uses"
              description="How many clients may register with it."
              unit="uses"
              value={page.uses}
              error={page.errors.uses}
              onChange={page.editUses}
            />
          </GridCell>
          <GridCell>
            <NumberWithUnitField
              label="Lifetime"
              description="How long it stays live."
              unit="seconds"
              value={page.lifetime}
              error={page.errors.ttl_seconds}
              onChange={page.editLifetime}
            />
          </GridCell>
        </FieldGrid>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={page.minting}>
            {page.minting ? 'Minting…' : 'Mint token'}
          </Button>
        </div>
        <LiveMessage label="Last mint">{page.message}</LiveMessage>
      </CreationForm>
    </Panel>
  );
}

function List({ tenant }: { tenant: string }) {
  const page = useRegistrationTokensPage(tenant);
  return (
    <>
      <ResourceListPage
        list={page.list}
        kicker={tenant}
        title={AREA.label}
        description="Initial access tokens for dynamic client registration."
        lead={<Mint page={page} />}
        noun={NOUN}
        columns={columns(page)}
        rowKey={(token) => token.id}
        capability="manage-clients"
        nothingYet={NOTHING_YET}
        notice={
          <LastAction label="Last revoke" count={page.revoked}>
            {page.notice}
          </LastAction>
        }
      />
      <SecretDialog
        secret={page.secret}
        title="New registration token"
        label="registration token"
        onClose={page.closeSecret}
      >
        A client presents it to register itself.
      </SecretDialog>
      <ConfirmDialog
        isOpen={page.revoking !== null}
        title="Revoke this token?"
        consequence={page.consequence}
        confirmLabel="Revoke token"
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
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
