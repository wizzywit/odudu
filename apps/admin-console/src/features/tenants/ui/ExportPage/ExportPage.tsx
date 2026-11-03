import { areaAt } from '#/entities/area';
import { useArea } from '#/widgets/shell';
import { ExportPanel } from '#/features/tenants/ui/ExportPanel';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { PageNotFound } from '#/shared/ui/PageNotFound';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Skeleton } from '#/shared/ui/Skeleton';

// A tenant's own export. Importing makes a new tenant, which is a system
// administrator's to do, under System › Tenants.
export function ExportPage({ tenant }: { tenant: string }) {
  const area = areaAt('export');
  const access = useArea(tenant, area);
  if (access.kind === 'hidden') return <PageNotFound />;
  return (
    <>
      <PageHeader kicker={tenant} title={area.label} />
      {access.kind === 'checking' ? <Skeleton label="Checking access to Export" /> : null}
      {access.kind === 'refused' ? (
        <CapabilityNote capability={access.capability}>{area.label}</CapabilityNote>
      ) : null}
      {access.kind === 'open' ? <ExportPanel tenant={tenant} authority={tenant} /> : null}
    </>
  );
}
