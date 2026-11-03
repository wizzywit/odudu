import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { clientsTrail } from '#/entities/client';
import { type BrandingOffer } from '#/pages/clients/services/branding';
import { type ServiceAccountReach } from '#/pages/clients/services/ceiling';
import type { ClientTab } from '#/pages/clients/services/tabs';
import { useClientFrame } from '#/pages/clients/use-cases/useClientFrame';
import { useClientRecordPage } from '#/pages/clients/use-cases/useClientRecordPage';
import type { ClientTabProps } from '#/pages/clients/ui/ClientTabProps';
import { AdvancedTab } from '#/pages/clients/ui/AdvancedTab';
import { BrandingTab } from '#/pages/clients/ui/BrandingTab';
import { GeneralTab } from '#/pages/clients/ui/GeneralTab';
import { LogoutTab } from '#/pages/clients/ui/LogoutTab';
import { RedirectsTab } from '#/pages/clients/ui/RedirectsTab';
import { RolesTab } from '#/pages/clients/ui/RolesTab';
import { ScopesTab } from '#/pages/clients/ui/ScopesTab';
import { SessionsTab } from '#/pages/clients/ui/SessionsTab';
import { ServiceAccountTab } from '#/pages/clients/ui/ServiceAccountTab';
import { TokensTab } from '#/pages/clients/ui/TokensTab';
import { Note } from '#/shared/ui/Note';
import { RecordActivity } from '#/features/record-activity';
import { RecordPage } from '#/shared/ui/RecordPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';

interface PanelProps extends ClientTabProps {
  reach: ServiceAccountReach;
  branding: BrandingOffer;
  brandingHeld: { lead: string; needs: string };
  activityNote: string;
}

function Activity({ tenant, id, lead }: { tenant: string; id: string; lead: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <RecordActivity resource="client" tenant={tenant} id={id} lead={lead} readable={readable} />
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
      held={props.brandingHeld}
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
  activity: (props) => (
    <Activity tenant={props.tenant} id={props.client.id} lead={props.activityNote} />
  ),
};

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useClientRecordPage(tenant, id);
  const { client, etag } = page;
  const { title } = page;
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
          brandingHeld: page.brandingHeld,
          activityNote: page.activityNote,
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
      tabs={page.tabList.map(({ id, label, dirty }) => ({
        id,
        label,
        dirty,
        panel: props === null ? null : PANELS[id](props),
      }))}
    />
  );
}

export function ClientRecordPage({ tenant, id }: { tenant: string; id: string }) {
  const { record } = useClientFrame(tenant);
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('clients')}
      title={record.title}
      breadcrumb={record.breadcrumb}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
