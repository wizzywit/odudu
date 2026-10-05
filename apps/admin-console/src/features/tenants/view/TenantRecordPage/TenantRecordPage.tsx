import { enterHref, tenantsTrail } from '#/features/tenants/service.ts';
import {
  useTenantRecordAccess,
  useTenantRecordPage,
  type TenantRecordAccess,
} from '#/features/tenants/usecase/useTenantRecordPage.ts';
import { AdministratorsTab } from '#/features/tenants/view/AdministratorsTab';
import { ExportPanel } from '#/features/tenants/view/ExportPanel';
import { GeneralTab } from '#/features/tenants/view/GeneralTab';
import { SystemGate } from '#/features/tenants/view/SystemGate';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { PageHeader } from '#/shared/view/PageHeader';
import { RecordPage } from '#/shared/view/RecordPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';

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
            status: tenant.enabled ? (
              <StatusTag tone="active">enabled</StatusTag>
            ) : (
              <StatusTag tone="danger">disabled</StatusTag>
            ),
            description: tenant.display_name ?? 'No display name',
          })}
      actions={<ButtonLink href={enterHref(name)}>{`Enter ${name}`}</ButtonLink>}
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
        actions={<ButtonLink href={enterHref(name)}>{`Enter ${name}`}</ButtonLink>}
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
