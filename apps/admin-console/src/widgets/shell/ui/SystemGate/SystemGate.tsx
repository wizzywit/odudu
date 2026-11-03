import type { ReactNode } from 'react';
import { useSystemArea } from '#/widgets/shell/use-cases/useSystemArea';
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
  const { access, kicker, checking } = useSystemArea(tenant, title);
  return (
    <AccessGate
      access={access}
      title={title}
      kicker={kicker}
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
      checking={checking}
    >
      {children}
    </AccessGate>
  );
}
