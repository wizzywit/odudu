import { useId } from 'react';
import type { Tenant } from '#/features/tenants/service.ts';
import { useTenantGeneral } from '#/features/tenants/usecase/useTenantGeneral.ts';
import { Button } from '#/shared/view/Button.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import { TextField } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { SectionNotice } from '#/shared/view/SectionNotice.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/tenants/view/GeneralTab.module.css';

export function GeneralTab({
  name,
  tenant,
  etag,
  gone,
  canChange,
}: {
  name: string;
  tenant: Tenant;
  etag: string;
  gone: boolean;
  // False once whoami says a change would be refused: the status is shown
  // with no control.
  canChange: boolean;
}) {
  const { general: s, enabled } = useTenantGeneral(name, tenant, etag, gone);
  const status = useId();
  return (
    <div className={styles.tab}>
      <Section
        title="General"
        description="What the console and the tenant's own pages call it. The name is fixed: it is in the issuer of every token the tenant has minted."
        dirty={s.dirty}
        saving={s.saving}
        onSave={s.submit}
        onDiscard={s.discard}
        restored={s.restored}
        blocked={s.blocked}
        notice={
          <SectionNotice
            section="General"
            status={s.status}
            conflicts={s.conflicts}
            conflictSource={s.conflictSource}
            message={s.message}
            busy={s.saving}
            onKeepMine={s.keepMine}
            onTakeTheirs={s.takeTheirs}
            onReread={s.reread}
          />
        }
      >
        <dl className={styles.fixed}>
          <dt>Name</dt>
          <dd>
            <code>{name}</code>
          </dd>
        </dl>
        <TextField
          label="Display name"
          description="Leave it empty for none."
          value={s.values.display_name}
          error={s.fieldErrors.display_name}
          changed={s.changed.includes('display_name')}
          onChange={(value) => {
            s.edit('display_name', value);
          }}
        />
      </Section>
      <section aria-labelledby={status} className={styles.status}>
        <h2 id={status} className={styles.heading}>
          Status
        </h2>
        <p className={styles.state}>
          {enabled.enabled ? (
            <StatusTag tone="active">enabled</StatusTag>
          ) : (
            <StatusTag tone="danger">disabled</StatusTag>
          )}{' '}
          {enabled.enabled
            ? `${name} is in service.`
            : `${name} answers as a tenant that does not exist until it is enabled again.`}
        </p>
        {enabled.fixed !== null ? (
          <p className={styles.fixedRule}>{enabled.fixed}</p>
        ) : canChange ? (
          <div className={styles.actions}>
            {/* One button whose label turns, so focus stays on it across the change. */}
            <Button
              variant={enabled.enabled ? 'danger' : 'secondary'}
              onPress={enabled.enabled ? enabled.ask : enabled.enable}
            >
              {enabled.enabled ? `Disable ${name}` : enabled.busy ? 'Enabling…' : `Enable ${name}`}
            </Button>
          </div>
        ) : null}
        <p role="status" className={styles.message}>
          {enabled.message}
        </p>
      </section>
      <ConfirmDialog
        isOpen={enabled.confirming}
        title={`Disable ${name}?`}
        consequence={`Nobody can sign in to ${name} while it is disabled, and its discovery document, tokens and endpoints answer as for a tenant that does not exist. Enabling it again undoes this.`}
        confirmLabel={`Disable ${name}`}
        tone="danger"
        typed={name}
        busy={enabled.busy}
        onConfirm={enabled.disable}
        onCancel={enabled.cancel}
      />
    </div>
  );
}
