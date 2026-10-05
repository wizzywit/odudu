import type { ReactNode } from 'react';
import { PageNotFound } from '#/features/shell';
import { useSubjectsArea } from '#/features/subjects/usecase/useSubjectsArea.ts';
import type { Crumb } from '#/shared/view/Breadcrumb';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { PageHeader } from '#/shared/view/PageHeader';

// whoami is advice: a principal it says cannot read subjects is told what
// that needs, rather than offered reads the server would refuse.
export function SubjectsGate({
  tenant,
  title,
  breadcrumb,
  children,
}: {
  tenant: string;
  title: string;
  // A page below the list keeps its way back while it is refused.
  breadcrumb?: readonly Crumb[];
  children: ReactNode;
}) {
  const access = useSubjectsArea(tenant);
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
