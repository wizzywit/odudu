import type { Area } from '#/features/shell/service.ts';
import { useArea } from '#/features/shell/usecase/useArea.ts';
import { PageNotFound } from '#/features/shell/view/PageNotFound';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { PageHeader } from '#/shared/view/PageHeader';
import { Skeleton } from '#/shared/view/Skeleton';

// Each area's page until its own feature takes the route.
export function AreaPage({ tenant, area }: { tenant: string; area: Area }) {
  const access = useArea(tenant, area);
  if (access.kind === 'hidden') return <PageNotFound />;
  return (
    <>
      <PageHeader kicker={tenant} title={area.label} />
      {access.kind === 'checking' ? <Skeleton label={`Checking access to ${area.label}`} /> : null}
      {access.kind === 'refused' ? (
        <CapabilityNote capability={access.capability}>{area.label}</CapabilityNote>
      ) : null}
      {access.kind === 'open' ? (
        <p>{`${area.label} is not in this build of the console yet.`}</p>
      ) : null}
    </>
  );
}
