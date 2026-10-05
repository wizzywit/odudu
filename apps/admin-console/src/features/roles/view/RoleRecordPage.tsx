import type { ReactNode } from 'react';
import { AreaGate, areaAt } from '#/features/shell/index.ts';
import { SubjectMembers } from '#/features/subjects/index.ts';
import {
  ROLE_TAB_LABELS,
  ROLE_TABS,
  rolesTrail,
  type Role,
  type RoleTab,
} from '#/features/roles/service.ts';
import { useAuditReadable, useRoleActivity } from '#/features/roles/usecase/useRoleActivity.ts';
import { useRoleRecordPage, type Ceiling } from '#/features/roles/usecase/useRoleRecordPage.ts';
import { CompositesTab } from '#/features/roles/view/CompositesTab.tsx';
import { GeneralTab } from '#/features/roles/view/GeneralTab.tsx';
import { Owner } from '#/features/roles/view/Owner.tsx';
import { ActivityTab } from '#/shared/view/ActivityTab.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { RecordPage } from '#/shared/view/RecordPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import noteStyles from '#/shared/view/CapabilityNote.module.css';
import styles from '#/features/roles/view/Tab.module.css';

interface PanelProps {
  tenant: string;
  role: Role;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}

function Trail({ tenant, id }: { tenant: string; id: string }) {
  const list = useRoleActivity(tenant, id);
  return <ActivityTab list={list} noun="role" />;
}

function Activity({ tenant, id }: { tenant: string; id: string }) {
  const readable = useAuditReadable(tenant);
  return (
    <div className={styles.tab}>
      <p className={styles.rule}>
        Every change made to this role, and every change refused. Its being given to a subject, a
        group or a scope is filed under that subject, group or scope.
      </p>
      {readable ? (
        <Trail tenant={tenant} id={id} />
      ) : (
        <CapabilityNote capability="view-audit">Activity</CapabilityNote>
      )}
    </div>
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
  if (ceiling.status === 'failed') {
    return (
      <p role="note" className={noteStyles.note}>
        What this role nests could not be read, so no delete, default or composite change is offered
        until it is.{' '}
        <Button size="small" variant="quiet" onPress={ceiling.retry}>
          Read it again
        </Button>
      </p>
    );
  }
  if (ceiling.status !== 'ready' || ceiling.deleteHeld === null) return null;
  return (
    <p role="note" className={noteStyles.note}>
      {ceiling.deleteHeld}
    </p>
  );
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
                <Owner role={role} />
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
