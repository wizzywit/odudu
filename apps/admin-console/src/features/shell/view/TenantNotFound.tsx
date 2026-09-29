import { Link } from 'react-aria-components';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import styles from '#/features/shell/view/TenantNotFound.module.css';

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
        {`No tenant is named ${tenant}.`}
      </EmptyState>
    </>
  );
}
