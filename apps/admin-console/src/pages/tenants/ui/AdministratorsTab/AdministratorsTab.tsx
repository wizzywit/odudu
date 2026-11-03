import { Link } from 'react-aria-components';
import { CapabilityHolders } from '#/features/subject-capabilities';
import { useTenantAdministrators } from '#/pages/tenants/use-cases/useTenantAdministrators';
import { Button } from '#/shared/ui/Button';
import styles from '#/pages/tenants/ui/AdministratorsTab/AdministratorsTab.module.css';

// `canAdd` is false once whoami says adding would be refused; the page says
// what it needs, and no add is offered.
export function AdministratorsTab({ tenant, canAdd }: { tenant: string; canAdd: boolean }) {
  const { begin, counted, systemAdminsHref, canChange, authorityTenant } =
    useTenantAdministrators(tenant);
  return (
    <div className={styles.tab}>
      <p className={styles.lead}>
        {`Everybody who holds an admin capability in ${tenant}, Full (tenant-admin) or a part of it, directly, through a group or under another role. A change that would leave ${tenant} with no enabled administrator is refused: the last one cannot be disabled, deleted, or lose ${counted}.`}
        {systemAdminsHref === null ? null : (
          <>
            {' '}
            They are managed under <Link href={systemAdminsHref}>System administrators</Link>.
          </>
        )}
      </p>
      {canAdd ? (
        <div className={styles.actions}>
          <Button onPress={begin.start}>Add an administrator</Button>
        </div>
      ) : null}
      <CapabilityHolders tenant={tenant} authorityTenant={authorityTenant} canChange={canChange} />
    </div>
  );
}
