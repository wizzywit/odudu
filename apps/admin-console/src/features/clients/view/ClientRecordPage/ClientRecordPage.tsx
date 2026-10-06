import type { Client } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { useAuditReadable } from '#/features/session';
import { AreaGate, areaAt } from '#/features/shell';
import {
  CLIENT_TAB_LABELS,
  CLIENT_TABS,
  ACTIVITY_NOTE,
  clientsTrail,
  type ClientTab,
  type Reach,
} from '#/features/clients/service';
import { useClientActivity } from '#/features/clients/usecase/useClientActivity.ts';
import { useClientRecordPage } from '#/features/clients/usecase/useClientRecordPage.ts';
import { AdvancedTab } from '#/features/clients/view/ClientRecordPage/AdvancedTab.tsx';
import { GeneralTab } from '#/features/clients/view/ClientRecordPage/GeneralTab.tsx';
import { LogoutTab } from '#/features/clients/view/ClientRecordPage/LogoutTab.tsx';
import { RedirectsTab } from '#/features/clients/view/ClientRecordPage/RedirectsTab.tsx';
import { RolesTab } from '#/features/clients/view/ClientRecordPage/RolesTab.tsx';
import { ScopesTab } from '#/features/clients/view/ClientRecordPage/ScopesTab.tsx';
import { ServiceAccountTab } from '#/features/clients/view/ClientRecordPage/ServiceAccountTab.tsx';
import { TokensTab } from '#/features/clients/view/ClientRecordPage/TokensTab.tsx';
import { ActivityTab } from '#/shared/view/ActivityTab';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { Note } from '#/shared/view/Note';
import { RecordPage } from '#/shared/view/RecordPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

interface PanelProps {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
  writable: boolean;
  reach: Reach;
}

function Trail({ tenant, id }: { tenant: string; id: string }) {
  const list = useClientActivity(tenant, id);
  return <ActivityTab list={list} noun="client" />;
}

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <div className={styles.tab}>
      <p className={styles.rule}>{ACTIVITY_NOTE}</p>
      {readable ? (
        <Trail tenant={tenant} id={id} />
      ) : (
        <CapabilityNote capability="view-audit">Activity</CapabilityNote>
      )}
    </div>
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
        };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={clientsTrail(tenant, title)}
      title={title}
      {...(client === undefined
        ? {}
        : {
            status: client.enabled ? (
              <StatusTag tone="active">enabled</StatusTag>
            ) : (
              <StatusTag tone="danger">disabled</StatusTag>
            ),
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
