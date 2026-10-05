import type { ReactNode } from 'react';
import type { Area } from '#/features/shell/service.ts';
import { useArea } from '#/features/shell/usecase/useArea.ts';
import { PageNotFound } from '#/features/shell/view/PageNotFound.tsx';
import type { Crumb } from '#/shared/view/Breadcrumb.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';

// whoami is advice: a principal it says cannot read the area is told what
// that needs, rather than offered reads the server would refuse.
export function AreaGate({
  tenant,
  area,
  title,
  breadcrumb,
  children,
}: {
  tenant: string;
  area: Area;
  title: string;
  // A page below the list keeps its way back while it is refused.
  breadcrumb?: readonly Crumb[];
  children: ReactNode;
}) {
  const access = useArea(tenant, area);
  switch (access.kind) {
    case 'hidden':
      return <PageNotFound />;
    case 'refused':
      return (
        <>
          <PageHeader
            {...(breadcrumb === undefined ? { kicker: tenant } : { breadcrumb })}
            title={title}
          />
          <CapabilityNote capability={access.capability}>{title}</CapabilityNote>
        </>
      );
    case 'checking':
    case 'open':
      return children;
  }
}
