import { type TenantRecordAccess } from '#/pages/tenants/services/access';
import {
  useTenantRecordAccess,
  useTenantRecordFrame,
  useTenantRecordPage,
} from '#/pages/tenants/use-cases/useTenantRecordPage';
import { AdministratorsTab } from '#/pages/tenants/ui/AdministratorsTab';
import { ExportPanel } from '#/pages/tenants/ui/ExportPanel';
import { GeneralTab } from '#/pages/tenants/ui/GeneralTab';
import { SystemGate } from '#/widgets/shell';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { PageHeader } from '#/shared/ui/PageHeader';
import { RecordPage } from '#/shared/ui/RecordPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';

function Record({ name, access }: { name: string; access: TenantRecordAccess }) {
  const page = useTenantRecordPage(name);
  const { breadcrumb, enterHref } = useTenantRecordFrame(name);
  const tenant = page.tenant;
  return (
    <RecordPage
      record={page.record}
      breadcrumb={breadcrumb}
      title={name}
      {...(tenant === undefined
        ? {}
        : {
            status: <EnabledTag enabled={tenant.enabled} />,
            description: tenant.displayName ?? 'No display name',
          })}
      actions={<ButtonLink href={enterHref}>{`Enter ${name}`}</ButtonLink>}
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
  const { breadcrumb, enterHref } = useTenantRecordFrame(name);
  if (access.readNeeds.length === 0) return <Record name={name} access={access} />;
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={name}
        actions={<ButtonLink href={enterHref}>{`Enter ${name}`}</ButtonLink>}
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
  const { breadcrumb } = useTenantRecordFrame(name);
  return (
    <SystemGate tenant={tenant} title={name} breadcrumb={breadcrumb}>
      <Readable name={name} />
    </SystemGate>
  );
}
