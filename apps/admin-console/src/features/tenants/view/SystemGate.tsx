import type { ReactNode } from 'react';
import { PageNotFound } from '#/features/shell/index.ts';
import { useTenantsArea } from '#/features/tenants/usecase/useTenantsArea.ts';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

// The page is drawn, and its reads made, only once whoami says the System
// area is this principal's; anywhere else its address is simply not a page.
export function SystemGate({
  tenant,
  title,
  children,
}: {
  tenant: string;
  title: string;
  children: ReactNode;
}) {
  const access = useTenantsArea(tenant);
  switch (access.kind) {
    case 'hidden':
      return <PageNotFound />;
    case 'checking':
      return (
        <>
          <PageHeader kicker="System" title={title} />
          <Skeleton label={`Checking access to ${title}`} />
        </>
      );
    case 'refused':
      return (
        <>
          <PageHeader kicker="System" title={title} />
          <CapabilityNote capability={access.capability}>{title}</CapabilityNote>
        </>
      );
    case 'open':
      return children;
  }
}
