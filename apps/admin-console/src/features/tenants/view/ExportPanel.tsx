import { useId } from 'react';
import { useTenantExport } from '#/features/tenants/usecase/useTenantExport.ts';
import { Button } from '#/shared/view/Button';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ToggleField } from '#/shared/view/Field.tsx';
import styles from '#/features/tenants/view/ExportPanel.module.css';

// `authority` names the tenant whoami answers for: the tenant itself, or
// `system` for a system administrator exporting another.
export function ExportPanel({ tenant, authority }: { tenant: string; authority: string }) {
  const state = useTenantExport(tenant, authority);
  const heading = useId();
  const blocked = state.needs.length > 0;
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {`Export ${tenant}`}
      </h2>
      <p className={styles.lead}>
        {`A file of ${tenant}'s configuration: settings, the sign-in flow, clients, roles, groups, scopes, the registration policy and the mail relay. No secret is in it; the file lists each one it left out. Importing it creates a new tenant.`}
      </p>
      {state.needs.map((capability) => (
        <CapabilityNote key={capability} capability={capability}>
          An export
        </CapabilityNote>
      ))}
      {blocked || state.subjectsNeed !== null ? null : (
        <ToggleField
          label="Include subjects"
          description="Their profiles, roles, groups and required actions, up to 10,000; never a credential."
          value={state.includeSubjects}
          onChange={state.setIncludeSubjects}
        />
      )}
      {blocked || state.subjectsNeed === null ? null : (
        <CapabilityNote capability={state.subjectsNeed}>Including subjects</CapabilityNote>
      )}
      {blocked ? null : (
        <div className={styles.actions}>
          <Button variant="primary" isDisabled={state.busy} onPress={state.start}>
            {state.busy ? 'Exporting…' : 'Export to a file'}
          </Button>
        </div>
      )}
      <p role="status" className={styles.message}>
        {state.message ??
          (state.saved === null ? '' : `Saved ${state.saved.fileName}, ${state.saved.size}.`)}
      </p>
      {state.saved === null ? null : (
        <div className={styles.saved}>
          <h3 className={styles.subheading}>Left out of the file</h3>
          {state.saved.omitted.length === 0 ? (
            <p className={styles.lead}>Nothing: the tenant holds no secret an export leaves out.</p>
          ) : (
            <ul aria-label="Left out of the file" className={styles.omitted}>
              {state.saved.omitted.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
