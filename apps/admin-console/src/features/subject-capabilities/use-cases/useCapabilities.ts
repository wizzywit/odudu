import { missingRoleIdDefect } from '#/features/subject-capabilities/services/adminRolesRead';
import { reportDefect } from '#/shared/lib/platform/report';
import type { SetRolesResponse } from '#/entities/subject';
import { useAuthority, useRefusal, useRereadAuthority } from '#/entities/session';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import {
  holdingsIn,
  type Holding,
  type HoldingOption,
  accessRefusal,
  removalConfirmation,
  type Confirmation,
  administratorCapability,
} from '#/shared/lib/services/capabilities';
import { inOrderOf, removedFrom } from '#/shared/lib/services/ids';
import type { AdminCapability } from '#/shared/lib/services/principal';
import { useSaveConfirmation } from '#/shared/lib/use-cases/useSaveConfirmation';
import {
  adminRolesBlocked,
  rolesFailure,
} from '#/features/subject-capabilities/services/adminRolesRead';
import { capabilitiesRemoveTenants } from '#/features/subject-capabilities/services/tenantReach';
import {
  capabilityOptions,
  describeHoldings,
} from '#/features/subject-capabilities/services/capabilityChoices';
import {
  elsewhereText,
  heldElsewhere,
  type HeldElsewhere,
} from '#/features/subject-capabilities/services/heldElsewhere';
import { keptOtherwise, onlyHolder } from '#/features/subject-capabilities/services/lastHolder';
import { offersWrites } from '#/shared/lib/services/access';
import {
  type Subject,
  useAdminRoleIds,
  useHeldCapabilities,
  useEnabledHolderCount,
  useRolesRecord,
  useSaveRoles,
  subjectName,
  rolesRecord,
  subjectTabHref,
  roleIdsOf,
  splitRoles,
  beyondText,
  heldOf,
  subjectBeyond,
} from '#/entities/subject';

export function useSubjectRolesRead(tenant: string, id: string): RecordState<SetRolesResponse> {
  return useRolesRecord(tenant, id);
}

export interface CapabilityValues extends Readonly<Record<string, unknown>> {
  capabilities: readonly Holding[];
}

export type CapabilityChoice = HoldingOption;

export type { HeldElsewhere };

export interface CapabilityEditing {
  name: string;
  // False without manage-users: what is held is shown as text.
  canManage: boolean;
  // Held by the subject and not by the caller, which puts the subject out
  // of reach (ADR 0040); empty when it is within reach, or not yet known.
  beyond: readonly AdminCapability[];
  options: readonly CapabilityChoice[];
  elsewhere: readonly HeldElsewhere[];
  // What is held only through a group or role, said as the start of the sentence naming where to change it.
  elsewhereText: string;
  // Why a subject beyond the caller cannot be changed here.
  beyondText: string;
  groupsHref: string;
  rolesHref: string;
  // The admin roles could not be read, so nothing can be saved.
  rolesFailed: { retry: () => void } | null;
  save: SectionSave<CapabilityValues>;
  choose: (holdings: readonly string[]) => void;
  // Asked before a save that takes from yourself, or takes manage-tenants.
  confirming: Confirmation | null;
  confirm: () => void;
  cancel: () => void;
}

// The admin capabilities a subject is assigned, edited as one set beside
// its other roles, which every save sends back as the record holds them.
// `authorityTenant` is where whoami answers for the caller: a system
// administrator's own tenant when they act on another from the System area.
export function useCapabilityEditor({
  tenant,
  subject,
  data,
  etag,
  gone,
  authorityTenant = tenant,
  allowed = true,
  self = false,
}: {
  tenant: string;
  subject: Subject;
  data: SetRolesResponse;
  etag: string;
  gone: boolean;
  authorityTenant?: string;
  // False where the page has already ruled every write out.
  allowed?: boolean;
  // The subject is the caller.
  self?: boolean;
}): CapabilityEditing {
  const name = subjectName(subject);
  const authority = useAuthority(authorityTenant);
  const refusal = useRefusal(authorityTenant);
  const reread = useRereadAuthority(authorityTenant);
  const effective = useHeldCapabilities(tenant, subject.id);
  const adminRoles = useAdminRoleIds(tenant);
  const counted = administratorCapability(tenant);
  const enabledHolders = useEnabledHolderCount(tenant, counted);
  const saveRoles = useSaveRoles(tenant, subject.id);
  const split = splitRoles(data.items);
  const base = inOrderOf(holdingsIn(tenant), split.holdings);
  const caller = authority?.capabilities;
  const held = heldOf(effective);
  const beyond = subjectBeyond(effective, caller);
  const canManage = offersWrites(allowed, authority);

  const save = useSectionSave({
    tenant,
    record: rolesRecord(subject.id),
    section: 'capabilities',
    label: 'Admin capabilities',
    etag,
    capability: 'manage-users',
    gone,
    refusal,
    explain: accessRefusal(name, 'roles', self),
    fields: {
      capabilities: {
        value: base,
        label: 'Admin capabilities',
        kind: 'plain',
        describe: describeHoldings,
      },
    },
    save: async (gateway, { values, ifMatch }) => {
      const roles = roleIdsOf(values.capabilities, adminRoles);
      if ('missing' in roles) {
        reportDefect(missingRoleIdDefect(roles.missing, tenant));
        return { ok: false, kind: 'defect' };
      }
      const result = await saveRoles(gateway, [...split.roleIds, ...roles.ids], ifMatch);
      if (result.ok && self) reread();
      return result;
    },
  });

  const asking = useSaveConfirmation<Confirmation>(save);
  const chosen = save.values.capabilities;
  const removed = removedFrom(base, chosen);
  const kept = keptOtherwise(held, counted);
  const removesTenants = capabilitiesRemoveTenants(tenant, base, chosen, kept);
  const guarded = onlyHolder({
    enabled: subject.enabled,
    held,
    counted,
    holders: enabledHolders,
    keptOtherwise: kept,
    chosen,
  });
  const blocked = adminRolesBlocked(adminRoles.status, save.blocked);
  const elsewhere = heldElsewhere(held, chosen);

  return {
    name,
    canManage,
    beyond,
    options: capabilityOptions({ tenant, name, chosen, caller, held, guarded, counted }),
    elsewhere,
    elsewhereText: elsewhereText(name, elsewhere),
    beyondText: beyondText(name, beyond, 'change'),
    groupsHref: subjectTabHref(tenant, subject.id, 'groups'),
    rolesHref: subjectTabHref(tenant, subject.id, 'roles'),
    rolesFailed: rolesFailure(adminRoles),
    save: {
      ...save,
      blocked,
      submit: () => {
        if (blocked !== undefined) return false;
        return asking.submitOrAsk(removalConfirmation({ name, self, removed, removesTenants }), {
          whenAsked: true,
        });
      },
    },
    choose: (value) => {
      save.edit('capabilities', inOrderOf(holdingsIn(tenant), value));
    },
    confirming: asking.confirming,
    confirm: asking.confirm,
    cancel: asking.cancel,
  };
}
