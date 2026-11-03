import type { ReactNode } from 'react';
import { useSubjectsArea } from '#/pages/subjects/use-cases/useSubjectsArea';
import { AccessGate } from '#/shared/ui/AccessGate';
import type { Crumb } from '#/shared/ui/Breadcrumb';

export function SubjectsGate({
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
  const access = useSubjectsArea(tenant);
  return (
    <AccessGate
      access={access}
      title={title}
      kicker={tenant}
      checking={null}
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
    >
      {children}
    </AccessGate>
  );
}
