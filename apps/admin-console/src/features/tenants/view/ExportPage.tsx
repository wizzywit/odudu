import { areaAt, PageNotFound, useArea } from '#/features/shell/index.ts';
import { ExportPanel } from '#/features/tenants/view/ExportPanel.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';

// A tenant's own export. Importing makes a new tenant, which is a system
// administrator's to do, under System › Tenants.
export function ExportPage({ tenant }: { tenant: string }) {
  const access = useArea(tenant, areaAt('export'));
  if (access.kind === 'hidden') return <PageNotFound />;
  return (
    <>
      <PageHeader kicker={tenant} title="Export" />
      {access.kind === 'checking' ? <Skeleton label="Checking access to Export" /> : null}
      {access.kind === 'refused' ? (
        <CapabilityNote capability={access.capability}>Export</CapabilityNote>
      ) : null}
      {access.kind === 'open' ? <ExportPanel tenant={tenant} authority={tenant} /> : null}
    </>
  );
}
