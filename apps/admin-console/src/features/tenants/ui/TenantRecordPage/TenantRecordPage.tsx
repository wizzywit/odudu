import { type TenantRecordAccess } from '#/features/tenants/services/access';
import { tenantsTrail } from '#/features/tenants/services/systemTrail';
import {
  useTenantRecordAccess,
  useTenantRecordPage,
} from '#/features/tenants/use-cases/useTenantRecordPage';
import { AdministratorsTab } from '#/features/tenants/ui/AdministratorsTab';
import { ExportPanel } from '#/features/tenants/ui/ExportPanel';
import { GeneralTab } from '#/features/tenants/ui/GeneralTab';
import { SystemGate } from '#/widgets/shell';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { PageHeader } from '#/shared/ui/PageHeader';
import { RecordPage } from '#/shared/ui/RecordPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import { tenantPage } from '#/shared/services/address';

function Record({ name, access }: { name: string; access: TenantRecordAccess }) {
  const page = useTenantRecordPage(name);
  const tenant = page.tenant;
  return (
    <RecordPage
      record={page.record}
      breadcrumb={tenantsTrail(name)}
      title={name}
      {...(tenant === undefined
        ? {}
        : {
            status: <EnabledTag enabled={tenant.enabled} />,
            description: tenant.displayName ?? 'No display name',
          })}
      actions={<ButtonLink href={tenantPage(name)}>{`Enter ${name}`}</ButtonLink>}
      noun="tenant"
      {...(access.blocked === null
        ? {}
        : {
            viewOnly: (
              <ViewOnlyNote
                noun="tenants"
                change={access.blocked.change}
                needs={access.blocked.needs}
              />
            ),
          })}
      // Reading the record needs manage-tenant, which is all changing it
      // needs, so its own fields stay editable whatever the line says.
      readOnly={false}
      label="Tenant sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={[
        {
          id: 'general',
          label: 'General',
          dirty: page.dirty.has('general'),
          panel:
            tenant === undefined || page.etag === null ? null : (
              <GeneralTab name={name} tenant={tenant} etag={page.etag} gone={page.record.gone} />
            ),
        },
        {
          id: 'administrators',
          label: 'Administrators',
          panel: <AdministratorsTab tenant={name} canAdd={access.addNeeds.length === 0} />,
        },
        {
          id: 'export',
          label: 'Export',
          panel: <ExportPanel tenant={name} authority="system" />,
        },
      ]}
    />
  );
}

function Readable({ name }: { name: string }) {
  const access = useTenantRecordAccess(name);
  if (access.readNeeds.length === 0) return <Record name={name} access={access} />;
  return (
    <>
      <PageHeader
        breadcrumb={tenantsTrail(name)}
        title={name}
        actions={<ButtonLink href={tenantPage(name)}>{`Enter ${name}`}</ButtonLink>}
      />
      {access.readNeeds.map((capability) => (
        <CapabilityNote key={capability} capability={capability}>
          A tenant&apos;s record
        </CapabilityNote>
      ))}
    </>
  );
}

export function TenantRecordPage({ tenant, name }: { tenant: string; name: string }) {
  return (
    <SystemGate tenant={tenant} title={name} breadcrumb={tenantsTrail(name)}>
      <Readable name={name} />
    </SystemGate>
  );
}
