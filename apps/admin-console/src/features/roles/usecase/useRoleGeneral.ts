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
  defaultBlock,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  isBuiltin,
  roleRecord,
  roleSelfLoss,
  rolesHref,
} from '#/features/roles/service.ts';
import type { Ceiling } from '#/features/roles/usecase/useRoleRecordPage.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { judgedLoss, lossText, writeRefusal } from '#/shared/service/capabilities.ts';
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

function failureText(name: string, result: GatewayFailure): string {
  switch (result.kind) {
    case 'network':
      return `Could not confirm whether ${name} was deleted. It has not been sent again; look at the roles before trying again.`;
    case 'schema':
      return `${name} may have been deleted, but the answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not finish, so ${name} was not deleted. This is a fault in the console, not something you did.`;
    case 'problem':
      if (result.problem.status === 409 && result.problem.detail !== undefined) {
        return `Refused: ${result.problem.detail}.`;
      }
      return (
        writeRefusal(result.problem) ??
        `${name} was not deleted: ${result.problem.detail ?? result.problem.title}`
      );
  }
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
        label: 'Given to every new subject',
        kind: 'plain',
        describe: (value) => (value === true ? 'on' : 'off'),
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
  const asks = loss.kind === 'certain' || loss.kind === 'possible';
  return {
    description,
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    defaults: {
      save: defaults,
      fixed: defaultBlock(role),
      checking: ready === null && !isBuiltin(role),
    },
    deletion: {
      fixed: isBuiltin(role)
        ? `${role.name} is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.`
        : null,
      held: ready?.deleteHeld != null,
      checking: ready === null || loss.kind === 'checking',
      confirming: deleting,
      consequence: `${role.name} is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.${lossText(loss, role.name)}`,
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
              if (asks) reread();
              push({ tone: 'success', message: `${role.name} was deleted.` });
              go(rolesHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-tenant');
            setProblem(failureText(role.name, result));
          })
          .catch(() => {
            setProblem(failureText(role.name, { ok: false, kind: 'defect' }));
          });
      },
    },
  };
}
