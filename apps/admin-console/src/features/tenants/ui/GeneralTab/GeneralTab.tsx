import type { Tenant } from '#/features/tenants/types/tenant';
import { useTenantDelete } from '#/features/tenants/use-cases/useTenantDelete';
import { useTenantGeneral } from '#/features/tenants/use-cases/useTenantGeneral';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DeleteZone } from '#/shared/ui/DeleteZone';
import { TextField } from '#/shared/ui/Field';
import { SaveSection } from '#/shared/ui/SaveSection';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/features/tenants/ui/GeneralTab/GeneralTab.module.css';
import { DESCRIPTION_RULE } from '#/shared/services/labels';

// Absent for a caller the route would refuse; beside Disable, which a
// tenant needs first, it says so rather than offering a delete the server
// would turn away.
function Danger({ name, enabled }: { name: string; enabled: boolean }) {
  const deletion = useTenantDelete(name, enabled);
  const { state } = deletion;
  if (state.kind === 'hidden') return null;
  return (
    <DeleteZone
      name={name}
      deletion={deletion}
      consequence={deletion.consequence}
      typed={name}
      lead={
        <p className={recordTab.text}>
          Deletes {name} and everything it holds. This cannot be undone.
        </p>
      }
      {...(state.kind === 'fixed' || state.kind === 'disable-first'
        ? { note: <p className={recordTab.rule}>{state.text}</p> }
        : {})}
    />
  );
}

export function GeneralTab({
  name,
  tenant,
  etag,
  gone,
}: {
  name: string;
  tenant: Tenant;
  etag: string;
  gone: boolean;
}) {
  const { general: s, enabled } = useTenantGeneral(name, tenant, etag, gone);
  return (
    <div className={recordTab.tab}>
      <SaveSection
        title="General"
        description="What the console and the tenant's own pages call it. The name is fixed: it is in the issuer of every token the tenant has minted."
        save={s}
      >
        <dl className={recordTab.fixed}>
          <dt>Name</dt>
          <dd>
            <code>{name}</code>
          </dd>
        </dl>
        <TextField
          label="Display name"
          description={DESCRIPTION_RULE}
          value={s.values.display_name}
          error={s.fieldErrors.display_name}
          changed={s.changed.includes('display_name')}
          onChange={(value) => {
            s.edit('display_name', value);
          }}
        />
      </SaveSection>
      <Panel title="Status">
        <p className={recordTab.text}>
          <EnabledTag enabled={enabled.enabled} />{' '}
          {enabled.enabled
            ? `${name} is in service.`
            : `${name} answers as a tenant that does not exist until it is enabled again.`}
        </p>
        {enabled.fixed !== null ? (
          <p className={recordTab.rule}>{enabled.fixed}</p>
        ) : (
          <div className={recordTab.actions}>
            {/* One button whose label turns, so focus stays on it across the change. */}
            <Button
              variant={enabled.enabled ? 'danger' : 'secondary'}
              onPress={enabled.enabled ? enabled.ask : enabled.enable}
            >
              {enabled.enabled ? `Disable ${name}` : enabled.busy ? 'Enabling…' : `Enable ${name}`}
            </Button>
          </div>
        )}
        <p role="status" className={styles.message}>
          {enabled.message}
        </p>
      </Panel>
      <ConfirmDialog
        isOpen={enabled.confirming}
        title={`Disable ${name}?`}
        consequence={enabled.consequence}
        confirmLabel={`Disable ${name}`}
        tone="danger"
        typed={name}
        busy={enabled.busy}
        onConfirm={enabled.disable}
        onCancel={enabled.cancel}
      />
      <Danger name={name} enabled={tenant.enabled} />
    </div>
  );
}
