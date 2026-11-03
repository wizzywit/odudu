import type { ClientScope } from '@odudu/contracts/admin';
import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { scopesTrail } from '#/features/scopes/services/address';
import { copyHrefOf } from '#/features/scopes/services/copy';
import { SCOPE_TAB_LABELS, SCOPE_TABS, type ScopeTab } from '#/features/scopes/services/tabs';
import { useScopeRecordPage } from '#/features/scopes/use-cases/useScopeRecordPage';
import { ClientsTab } from '#/features/scopes/ui/ScopeRecordPage/ClientsTab';
import { GeneralTab } from '#/features/scopes/ui/ScopeRecordPage/GeneralTab';
import { MappersTab } from '#/features/scopes/ui/ScopeRecordPage/MappersTab';
import { RolesTab } from '#/features/scopes/ui/ScopeRecordPage/RolesTab';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { RecordPage, type RecordPanelProps } from '#/shared/ui/RecordPage';

type PanelProps = RecordPanelProps<'scope', ClientScope>;

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <RecordActivity
      resource="scope"
      tenant={tenant}
      id={id}
      lead="Every change made to this scope, and every change refused. A client being given or losing it is filed under that client."
      readable={readable}
    />
  );
}

// One panel per tab, in SCOPE_TABS' order.
const PANELS: Readonly<Record<ScopeTab, (props: PanelProps) => ReactNode>> = {
  general: (props) => <GeneralTab {...props} />,
  roles: (props) => <RolesTab tenant={props.tenant} scope={props.scope} />,
  mappers: (props) => <MappersTab tenant={props.tenant} scope={props.scope} />,
  clients: (props) => <ClientsTab tenant={props.tenant} scope={props.scope} />,
  activity: (props) => <Activity tenant={props.tenant} id={props.scope.id} />,
};

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useScopeRecordPage(tenant, id);
  const { scope, etag } = page;
  const title = scope?.name ?? 'Scope';
  const props: PanelProps | null =
    scope === undefined || etag === null ? null : { tenant, scope, etag, gone: page.record.gone };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={scopesTrail(tenant, title)}
      title={title}
      {...(scope?.description == null ? {} : { description: scope.description })}
      {...(scope === undefined
        ? {}
        : {
            actions: (
              <ButtonLink href={copyHrefOf(tenant, scope.id)} size="small">
                Create a copy
              </ButtonLink>
            ),
          })}
      noun="scope"
      readOnly={false}
      label="Scope sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={SCOPE_TABS.map((tab) => ({
        id: tab,
        label: SCOPE_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        panel: props === null ? null : PANELS[tab](props),
      }))}
    />
  );
}

export function ScopeRecordPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('scopes')}
      title="Scope"
      breadcrumb={scopesTrail(tenant, 'Scope')}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
