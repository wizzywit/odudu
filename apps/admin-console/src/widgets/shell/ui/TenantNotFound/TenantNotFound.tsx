import { Link } from 'react-aria-components';
import { useShellText } from '#/widgets/shell/use-cases/useShellText';
import { EmptyState } from '#/shared/ui/EmptyState';
import { PageHeader } from '#/shared/ui/PageHeader';
import styles from '#/widgets/shell/ui/TenantNotFound/TenantNotFound.module.css';

export function TenantNotFound({ tenant, chooseHref }: { tenant: string; chooseHref: string }) {
  const { tenantNotFoundText } = useShellText();
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
