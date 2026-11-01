import type { ReactNode } from 'react';
import { useAuditReadable } from '#/features/session';
import { AreaGate, areaAt } from '#/features/shell';
import {
  CLIENT_TAB_LABELS,
  CLIENT_TABS,
  ACTIVITY_NOTE,
  clientsTrail,
  type ClientTab,
  type BrandingOffer,
  type Reach,
} from '#/features/clients/service';
import { useClientRecordPage } from '#/features/clients/usecase/useClientRecordPage';
import type { ClientTabProps } from '#/features/clients/view/ClientTabProps';
import { AdvancedTab } from '#/features/clients/view/AdvancedTab';
import { BrandingTab } from '#/features/clients/view/BrandingTab';
import { GeneralTab } from '#/features/clients/view/GeneralTab';
import { LogoutTab } from '#/features/clients/view/LogoutTab';
import { RedirectsTab } from '#/features/clients/view/RedirectsTab';
import { RolesTab } from '#/features/clients/view/RolesTab';
import { ScopesTab } from '#/features/clients/view/ScopesTab';
import { SessionsTab } from '#/features/clients/view/SessionsTab';
import { ServiceAccountTab } from '#/features/clients/view/ServiceAccountTab';
import { TokensTab } from '#/features/clients/view/TokensTab';
import type { AdminCapability } from '#/shared/service/principal';
import { Note } from '#/shared/view/Note';
import { RecordActivity } from '#/shared/view/RecordActivity';
import { RecordPage } from '#/shared/view/RecordPage';
import { EnabledTag } from '#/shared/view/StatusTag';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';

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
  const title = client?.name ?? 'Client';
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
      title="Client"
      breadcrumb={clientsTrail(tenant, 'Client')}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
