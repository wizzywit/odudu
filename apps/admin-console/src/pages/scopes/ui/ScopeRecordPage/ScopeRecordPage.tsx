import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { type Scope, scopesTrail } from '#/entities/scope';
import type { ScopeTab } from '#/pages/scopes/services/tabs';
import { useScopeFrame } from '#/pages/scopes/use-cases/useScopeFrame';
import { useScopeRecordPage } from '#/pages/scopes/use-cases/useScopeRecordPage';
import { ClientsTab } from '#/pages/scopes/ui/ScopeRecordPage/ClientsTab';
import { GeneralTab } from '#/pages/scopes/ui/ScopeRecordPage/GeneralTab';
import { MappersTab } from '#/pages/scopes/ui/ScopeRecordPage/MappersTab';
import { RolesTab } from '#/pages/scopes/ui/ScopeRecordPage/RolesTab';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { RecordPage, type RecordPanelProps } from '#/shared/ui/RecordPage';

type PanelProps = RecordPanelProps<'scope', Scope>;

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
  const { title } = page;
  const props: PanelProps | null =
    scope === undefined || etag === null ? null : { tenant, scope, etag, gone: page.record.gone };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={scopesTrail(tenant, title)}
      title={title}
      {...(scope?.description == null ? {} : { description: scope.description })}
      {...(page.copyHref === null
        ? {}
        : {
            actions: (
              <ButtonLink href={page.copyHref} size="small">
                Create a copy
              </ButtonLink>
            ),
          })}
      noun="scope"
      readOnly={false}
      label="Scope sections"
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

export function ScopeRecordPage({ tenant, id }: { tenant: string; id: string }) {
  const { record } = useScopeFrame(tenant);
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('scopes')}
      title={record.title}
      breadcrumb={record.breadcrumb}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
