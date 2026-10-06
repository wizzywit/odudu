import type { Client } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { useAuditReadable } from '#/features/session';
import { AreaGate, areaAt } from '#/features/shell';
import {
  CLIENT_TAB_LABELS,
  CLIENT_TABS,
  ACTIVITY_NOTE,
  clientsTrail,
  NOT_BUILT,
  type ClientTab,
} from '#/features/clients/service';
import { useClientActivity } from '#/features/clients/usecase/useClientActivity.ts';
import { useClientRecordPage } from '#/features/clients/usecase/useClientRecordPage.ts';
import { GeneralTab } from '#/features/clients/view/ClientRecordPage/GeneralTab.tsx';
import { RedirectsTab } from '#/features/clients/view/ClientRecordPage/RedirectsTab.tsx';
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

function NotBuilt() {
  return <p className={styles.rule}>{NOT_BUILT}</p>;
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
  tokens: () => <NotBuilt />,
  scopes: () => <NotBuilt />,
  logout: () => <NotBuilt />,
  advanced: () => <NotBuilt />,
  activity: (props) => <Activity tenant={props.tenant} id={props.client.id} />,
};

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useClientRecordPage(tenant, id);
  const { client, etag } = page;
  const title = client?.name ?? 'Client';
  const props: PanelProps | null =
    client === undefined || etag === null
      ? null
      : { tenant, client, etag, gone: page.record.gone, writable: page.writable };
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
