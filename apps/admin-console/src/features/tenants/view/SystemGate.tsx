import type { ReactNode } from 'react';
import { PageNotFound } from '#/features/shell/index.ts';
import { useTenantsArea } from '#/features/tenants/usecase/useTenantsArea.ts';
import type { Crumb } from '#/shared/view/Breadcrumb.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

// The page is drawn, and its reads made, only once whoami says the System
// area is this principal's; anywhere else its address is simply not a page.
export function SystemGate({
  tenant,
  title,
  breadcrumb,
  children,
}: {
  tenant: string;
  title: string;
  // A page below a list keeps its way back while access is checked or refused.
  breadcrumb?: readonly Crumb[];
  children: ReactNode;
}) {
  const access = useTenantsArea(tenant);
  const head = (
    <PageHeader
      {...(breadcrumb === undefined ? { kicker: 'System' } : { breadcrumb })}
      title={title}
    />
  );
  switch (access.kind) {
    case 'hidden':
      return <PageNotFound />;
    case 'checking':
      return (
        <>
          {head}
          <Skeleton label={`Checking access to ${title}`} />
        </>
      );
    case 'refused':
      return (
        <>
          {head}
          <CapabilityNote capability={access.capability}>{title}</CapabilityNote>
        </>
      );
    case 'open':
      return children;
  }
}
