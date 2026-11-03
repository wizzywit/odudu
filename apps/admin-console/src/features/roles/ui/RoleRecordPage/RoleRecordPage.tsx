import type { ReactNode } from 'react';
import { useAuditReadable } from '#/entities/session';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { SubjectMembers } from '#/features/subjects';
import { rolesTrail, type Role } from '#/features/roles/services/address';
import { ROLE_TAB_LABELS, ROLE_TABS, type RoleTab } from '#/features/roles/services/tabs';
import { useRoleRecordPage, type Ceiling } from '#/features/roles/use-cases/useRoleRecordPage';
import { CompositesTab } from '#/features/roles/ui/RoleRecordPage/CompositesTab';
import { GeneralTab } from '#/features/roles/ui/RoleRecordPage/GeneralTab';
import { RecordActivity } from '#/shared/ui/RecordActivity';
import { RoleOwner } from '#/shared/ui/RoleOwner';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { RecordPage, type RecordPanelProps } from '#/shared/ui/RecordPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Note } from '#/shared/ui/Note';

type PanelProps = RecordPanelProps<'role', Role> & {
  ceiling: Ceiling;
};

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <RecordActivity
      resource="role"
      tenant={tenant}
      id={id}
      lead="Every change made to this role, and every change refused. Its being given to a subject, a group or a scope is filed under that subject, group or scope."
      readable={readable}
    />
  );
}

// One panel per tab, in ROLE_TABS' order.
const PANELS: Readonly<Record<RoleTab, (props: PanelProps) => ReactNode>> = {
  general: (props) => <GeneralTab {...props} />,
  composites: (props) => (
    <CompositesTab tenant={props.tenant} role={props.role} ceiling={props.ceiling} />
  ),
  members: (props) => (
    <SubjectMembers tenant={props.tenant} by="role" id={props.role.id} name={props.role.name} />
  ),
  activity: (props) => <Activity tenant={props.tenant} id={props.role.id} />,
};

function Lines({ ceiling }: { ceiling: Ceiling }) {
  if (ceiling.status !== 'ready' || ceiling.deleteHeld === null) return null;
  return <Note>{ceiling.deleteHeld}</Note>;
}

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useRoleRecordPage(tenant, id);
  const { role, etag } = page;
  const title = role?.name ?? 'Role';
  const props: PanelProps | null =
    role === undefined || etag === null
      ? null
      : { tenant, role, etag, gone: page.record.gone, ceiling: page.ceiling };
  return (
    <RecordPage
      record={page.record}
      breadcrumb={rolesTrail(tenant, title)}
      title={title}
      {...(role === undefined
        ? {}
        : {
            status: (
              <>
                <RoleOwner role={role} />
                {role.default_for_new_subjects ? (
                  <StatusTag tone="active">given to every new subject</StatusTag>
                ) : null}
              </>
            ),
          })}
      {...(role?.description == null ? {} : { description: role.description })}
      {...(page.copyHref === null
        ? {}
        : {
            actions: (
              <ButtonLink href={page.copyHref} size="small">
                Create a copy
              </ButtonLink>
            ),
          })}
      noun="role"
      viewOnly={<Lines ceiling={page.ceiling} />}
      readOnly={false}
      label="Role sections"
      tab={page.tab}
      onTabChange={page.selectTab}
      tabs={ROLE_TABS.map((tab) => ({
        id: tab,
        label: ROLE_TAB_LABELS[tab],
        dirty: page.dirty.has(tab),
        panel: props === null ? null : PANELS[tab](props),
      }))}
    />
  );
}

export function RoleRecordPage({ tenant, id }: { tenant: string; id: string }) {
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('roles')}
      title="Role"
      breadcrumb={rolesTrail(tenant, 'Role')}
    >
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
