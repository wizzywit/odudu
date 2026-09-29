import type { ReactNode } from 'react';
import { PageNotFound } from '#/features/shell/index.ts';
import { useSubjectsArea } from '#/features/subjects/usecase/useSubjectsArea.ts';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';

// whoami is advice: a principal it says cannot read subjects is told what
// that needs, rather than offered reads the server would refuse.
export function SubjectsGate({
  tenant,
  title,
  children,
}: {
  tenant: string;
  title: string;
  children: ReactNode;
}) {
  const access = useSubjectsArea(tenant);
  switch (access.kind) {
    case 'hidden':
      return <PageNotFound />;
    case 'refused':
      return (
        <>
          <PageHeader kicker={tenant} title={title} />
          <CapabilityNote capability={access.capability}>{title}</CapabilityNote>
        </>
      );
    case 'checking':
    case 'open':
      return children;
  }
}
