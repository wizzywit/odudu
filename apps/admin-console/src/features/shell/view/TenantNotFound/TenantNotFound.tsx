import { Link } from 'react-aria-components';
import { tenantNotFoundText } from '#/features/shell/service';
import { EmptyState } from '#/shared/view/EmptyState';
import { PageHeader } from '#/shared/view/PageHeader';
import styles from '#/features/shell/view/TenantNotFound/TenantNotFound.module.css';

export function TenantNotFound({ tenant, chooseHref }: { tenant: string; chooseHref: string }) {
  return (
    <>
      <PageHeader title="Tenant not found" />
      <EmptyState
        variant="nothing-matches"
        title="No tenant has this name"
        action={
          <Link href={chooseHref} className={styles.link ?? ''}>
            Choose a tenant
          </Link>
        }
      >
        {tenantNotFoundText(tenant)}
      </EmptyState>
    </>
  );
}
