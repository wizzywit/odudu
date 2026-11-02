import type { ReactNode } from 'react';
import { useTenantsArea } from '#/features/tenants/use-cases/useTenantsArea';
import { AccessGate } from '#/shared/ui/AccessGate';
import type { Crumb } from '#/shared/ui/Breadcrumb';

// The page is drawn, and its reads made, only once whoami says the System
// area is this principal's.
export function SystemGate({
  tenant,
  title,
  breadcrumb,
  children,
}: {
  tenant: string;
  title: string;
  breadcrumb?: readonly Crumb[];
  children: ReactNode;
}) {
  const access = useTenantsArea(tenant);
  return (
    <AccessGate
      access={access}
      title={title}
      kicker="System"
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
      checking={`Checking access to ${title}`}
    >
      {children}
    </AccessGate>
  );
}
