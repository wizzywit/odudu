import type { Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session';
import { useOwnRoles } from '#/features/subjects';
import { useGo } from '#/features/roles/repository/useGo.ts';
import {
  useRoleDeletion,
  useRoleSaves,
  type DefaultValues,
  type DescriptionValues,
} from '#/features/roles/repository/useRoleRecord.ts';
import {
  type Ceiling,
  defaultBlock,
  DEFAULT_LABEL,
  defaultsChecking,
  deleteChecking,
  deletionFixed,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  isDeleteHeld,
  roleDeleteConsequence,
  roleDeleteFailureText,
  roleRecord,
  roleSelfLoss,
  rolesHref,
} from '#/features/roles/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { asksFirst, judgedLoss, writeRefusal } from '#/shared/service/capabilities.ts';
import { deletedText } from '#/shared/service/failure.ts';
import { flagText } from '#/shared/service/format.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export type { SectionSave };

export interface Defaults {
  save: SectionSave<DefaultValues>;
  // Why it cannot be handed to every new subject, said in place of the toggle.
  fixed: string | null;
  checking: boolean;
}

export interface Deletion {
  // A capability role is never deleted, which is a rule rather than a ceiling.
  fixed: string | null;
  // Left out by the ceiling, which the page's one line explains.
  held: boolean;
  checking: boolean;
  confirming: boolean;
  consequence: string;
  busy: boolean;
  problem: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export interface RoleGeneral {
  description: SectionSave<DescriptionValues>;
  descriptionRule: string;
  descriptionLimit: number;
  defaults: Defaults;
  deletion: Deletion;
}

export function useRoleGeneral({
  tenant,
  role,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  role: Role;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}): RoleGeneral {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const saves = useRoleSaves(tenant, role.id);
  const deletion = useRoleDeletion(tenant, role.id);
  const push = useToasts((queue) => queue.push);
  const go = useGo();
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const record = roleRecord(role.id);
  const onRefused = (failure: GatewayFailure): void => {
    refusal.report(failure, 'manage-tenant');
  };
  const description = useSectionSave({
    tenant,
    record,
    section: 'description',
    label: 'Description',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused,
    explain: writeRefusal,
    fields: {
      description: { value: role.description ?? '', label: 'Description', kind: 'plain' },
    },
    save: saves.description,
  });
  const defaults = useSectionSave({
    tenant,
    record,
    section: 'default',
    label: 'New subjects',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused,
    explain: writeRefusal,
    fields: {
      default_for_new_subjects: {
        value: role.default_for_new_subjects,
        label: DEFAULT_LABEL,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
      },
    },
    save: saves.default,
  });
  const ready = ceiling.status === 'ready' ? ceiling : null;
  const loss = judgedLoss(
    own,
    (access) => roleSelfLoss(access.roles, { kind: 'delete', id: role.id }),
    ready?.caller ?? [],
    role.admin_reach,
  );
  return {
    description,
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    defaults: {
      save: defaults,
      fixed: defaultBlock(role),
      checking: defaultsChecking(role, ceiling),
    },
    deletion: {
      fixed: deletionFixed(role),
      held: isDeleteHeld(ceiling),
      checking: deleteChecking(ceiling, loss),
      confirming: deleting,
      consequence: roleDeleteConsequence(role.name, loss),
      busy: deletion.busy,
      problem,
      ask: () => {
        setProblem(null);
        setDeleting(true);
      },
      cancel: () => {
        setProblem(null);
        setDeleting(false);
      },
      confirm: () => {
        if (deletion.busy) return;
        setProblem(null);
        deletion
          .run()
          .then((result) => {
            if (result.ok) {
              setDeleting(false);
              if (asksFirst(loss)) reread();
              push({ tone: 'success', message: deletedText(role.name) });
              go(rolesHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-tenant');
            setProblem(roleDeleteFailureText(role.name, result));
          })
          .catch(() => {
            setProblem(roleDeleteFailureText(role.name, { ok: false, kind: 'defect' }));
          });
      },
    },
  };
}
