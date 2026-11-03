import type { ReactNode } from 'react';
import { type Area } from '#/entities/area';
import { useShellText } from '#/widgets/shell/use-cases/useShellText';
import { useArea } from '#/widgets/shell/use-cases/useArea';
import { AccessGate } from '#/shared/ui/AccessGate';
import type { Crumb } from '#/shared/ui/Breadcrumb';

// The page is not drawn, so makes none of its reads, until whoami has answered.
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
  breadcrumb?: readonly Crumb[];
  children: ReactNode;
}) {
  const access = useArea(tenant, area);
  const { checkingText } = useShellText();
  return (
    <AccessGate
      access={access}
      title={title}
      kicker={tenant}
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
      checking={checkingText(area)}
    >
      {children}
    </AccessGate>
  );
}
