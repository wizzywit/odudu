import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { clientsTrail } from '#/features/clients/services/address';
import { type BrandingOffer } from '#/features/clients/services/branding';
import { type Reach } from '#/features/clients/services/ceiling';
import { ACTIVITY_NOTE, CLIENT_TITLE } from '#/features/clients/services/clientDetails';
import { CLIENT_TAB_LABELS, CLIENT_TABS, type ClientTab } from '#/features/clients/services/tabs';
import { useClientRecordPage } from '#/features/clients/use-cases/useClientRecordPage';
import type { ClientTabProps } from '#/features/clients/ui/ClientTabProps';
import { AdvancedTab } from '#/features/clients/ui/AdvancedTab';
import { BrandingTab } from '#/features/clients/ui/BrandingTab';
import { GeneralTab } from '#/features/clients/ui/GeneralTab';
import { LogoutTab } from '#/features/clients/ui/LogoutTab';
import { RedirectsTab } from '#/features/clients/ui/RedirectsTab';
import { RolesTab } from '#/features/clients/ui/RolesTab';
import { ScopesTab } from '#/features/clients/ui/ScopesTab';
import { SessionsTab } from '#/features/clients/ui/SessionsTab';
import { ServiceAccountTab } from '#/features/clients/ui/ServiceAccountTab';
import { TokensTab } from '#/features/clients/ui/TokensTab';
import type { AdminCapability } from '#/shared/services/principal';
import { Note } from '#/shared/ui/Note';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { RecordPage } from '#/shared/ui/RecordPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';

interface PanelProps extends ClientTabProps {
  reach: Reach;
  branding: BrandingOffer;
  needs: readonly AdminCapability[];
}

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <RecordActivity
      resource="client"
      tenant={tenant}
      id={id}
      lead={ACTIVITY_NOTE}
      readable={readable}
    />
  );
}

// What a tab saving the client's own record is given.
function writes({ tenant, client, etag, gone, writable }: PanelProps) {
  return { tenant, client, etag, gone, writable };
}

// One panel per tab, in CLIENT_TABS' order.
const PANELS: Readonly<Record<ClientTab, (props: PanelProps) => ReactNode>> = {
  general: (props) => <GeneralTab {...props} />,
  redirects: (props) => (
    <RedirectsTab
      tenant={props.tenant}
      client={props.client}
      etag={props.etag}
      gone={props.gone}
      writable={props.writable}
    />
  ),
  tokens: (props) => <TokensTab {...writes(props)} />,
  scopes: (props) => <ScopesTab tenant={props.tenant} client={props.client} reach={props.reach} />,
  logout: (props) => <LogoutTab {...writes(props)} />,
  branding: (props) => (
    <BrandingTab
      tenant={props.tenant}
      client={props.client}
      offer={props.branding}
      needs={props.needs}
    />
  ),
  advanced: (props) => <AdvancedTab {...writes(props)} />,
  roles: (props) => <RolesTab tenant={props.tenant} client={props.client} />,
  service: (props) => (
    <ServiceAccountTab
      tenant={props.tenant}
      client={props.client}
      gone={props.gone}
      reach={props.reach}
    />
  ),
  sessions: (props) => (
    <SessionsTab tenant={props.tenant} client={props.client} reach={props.reach} />
  ),
  activity: (props) => <Activity tenant={props.tenant} id={props.client.id} />,
};

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useClientRecordPage(tenant, id);
  const { client, etag } = page;
  const title = client?.name ?? CLIENT_TITLE;
  const props: PanelProps | null =
    client === undefined || etag === null
      ? null
      : {
          tenant,
          client,
          etag,
          gone: page.record.gone,
          writable: page.writable,
          reach: page.reach,
          branding: page.branding,
          needs: page.changeNeeds,
        };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={clientsTrail(tenant, title)}
      title={title}
      {...(client === undefined
        ? {}
        : {
            status: <EnabledTag enabled={client.enabled} />,
            description: client.description ?? client.client_id,
          })}
      noun="client"
      viewOnly={
        <>
          {page.changeNeeds.length > 0 ? (
            <ViewOnlyNote noun="clients" needs={page.changeNeeds} />
          ) : null}
          {page.line === null ? null : <Note>{page.line}</Note>}
        </>
      }
      readOnly={!page.writable}
      label="Client sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={CLIENT_TABS.map((tab) => ({
        id: tab,
        label: CLIENT_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        panel: props === null ? null : PANELS[tab](props),
      }))}
    />
  );
}

export function ClientRecordPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('clients')}
      title={CLIENT_TITLE}
      breadcrumb={clientsTrail(tenant, CLIENT_TITLE)}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
