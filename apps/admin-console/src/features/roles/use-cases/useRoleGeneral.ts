import { useRefusal, useRereadAuthority } from '#/entities/session';
import { useOwnRoles } from '#/features/own-roles';
import { useGo } from '#/shared/repository/useGo';
import { useRoleDeletion, useRoleSaves } from '#/features/roles/repository/useRoleRecord';
import { type Role, rolesHref } from '#/entities/role';
import { defaultBlock } from '#/features/roles/services/roleDefault';
import { deletionFixed } from '#/features/roles/services/roleDeletion';
import {
  type RoleCeiling,
  defaultsChecking,
  isDeleteHeld,
} from '#/features/roles/services/roleCeiling';
import { roleSelfLoss } from '#/features/roles/services/roleLoss';
import { DEFAULT_LABEL } from '#/features/roles/services/roleDefault';
import { deleteChecking } from '#/features/roles/services/roleCeiling';
import {
  roleDeleteConsequence,
  roleDeleteFailureText,
} from '#/features/roles/services/roleDeletion';
import { roleRecord } from '#/features/roles/services/tabs';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';
import { judgedLoss, lossAction, writeRefusal } from '#/shared/services/capabilities';
import { deletedText } from '#/shared/services/failure';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import type { DefaultValues, DescriptionValues } from '#/shared/services/sectionValues';
import { orBlank } from '#/shared/services/format';
import { ceilingCaller } from '#/shared/services/access';

export type { SectionSave };

export interface Defaults {
  save: SectionSave<DefaultValues>;
  // Why it cannot be handed to every new subject, said in place of the toggle.
  fixed: string | null;
  checking: boolean;
}

export interface Deletion extends Removal {
  // A capability role is never deleted, which is a rule rather than a ceiling.
  fixed: string | null;
  // Left out by the ceiling, which the page's one line explains.
  held: boolean;
  checking: boolean;
  consequence: string;
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
  ceiling: RoleCeiling;
}): RoleGeneral {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const saves = useRoleSaves(tenant, role.id);
  const deletion = useRoleDeletion(tenant, role.id);
  const toast = useToast();
  const go = useGo();
  const record = roleRecord(role.id);
  const description = useSectionSave({
    tenant,
    record,
    section: 'description',
    label: 'Description',
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      description: { value: orBlank(role.description), label: 'Description', kind: 'plain' },
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
    refusal,
    explain: writeRefusal,
    fields: {
      default_for_new_subjects: {
        value: role.default_for_new_subjects,
        label: DEFAULT_LABEL,
        kind: 'plain',
      },
    },
    save: saves.default,
  });
  const loss = judgedLoss(
    own,
    (access) => roleSelfLoss(access.roles, { kind: 'delete', id: role.id }),
    ceilingCaller(ceiling),
    role.admin_reach,
  );
  const removal = useConfirmedRemoval({
    refusal,
    capability: 'manage-tenant',
    change: deletion,
    failureText: (failure) => roleDeleteFailureText(role.name, failure),
    done: () => {
      if (lossAction(loss) === 'ask') reread();
      toast.succeeded(deletedText(role.name));
      go(rolesHref(tenant), { replace: true });
    },
  });
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
      ...removal,
      fixed: deletionFixed(role),
      held: isDeleteHeld(ceiling),
      checking: deleteChecking(ceiling, loss),
      consequence: roleDeleteConsequence(role.name, loss),
    },
  };
}
