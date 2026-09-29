import { enterHref, tenantsTrail } from '#/features/tenants/service.ts';
import { useTenantRecordPage } from '#/features/tenants/usecase/useTenantRecordPage.ts';
import { AdministratorsTab } from '#/features/tenants/view/AdministratorsTab.tsx';
import { ExportPanel } from '#/features/tenants/view/ExportPanel.tsx';
import { GeneralTab } from '#/features/tenants/view/GeneralTab.tsx';
import { SystemGate } from '#/features/tenants/view/SystemGate.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { RecordPage } from '#/shared/view/RecordPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote.tsx';

function Record({ name }: { name: string }) {
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
      {...(page.blocked === null
        ? {}
        : {
            viewOnly: (
              <ViewOnlyNote
                noun="tenants"
                change={page.blocked.change}
                needs={page.blocked.needs}
              />
            ),
          })}
      readOnly={!page.canChange}
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
              <GeneralTab
                name={name}
                tenant={tenant}
                etag={page.etag}
                gone={page.record.gone}
                canChange={page.canChange}
              />
            ),
        },
        {
          id: 'administrators',
          label: 'Administrators',
          panel: <AdministratorsTab tenant={name} canAdd={page.addNeeds.length === 0} />,
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

export function TenantRecordPage({ tenant, name }: { tenant: string; name: string }) {
  return (
    <SystemGate tenant={tenant} title={name} breadcrumb={tenantsTrail(name)}>
      <Record name={name} />
    </SystemGate>
  );
}
