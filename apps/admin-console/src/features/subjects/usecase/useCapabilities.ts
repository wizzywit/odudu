import type { SetRolesResponse, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal, useRereadAuthority } from '#/features/session';
import {
  useAdminRoleIds,
  useEffectiveRoles,
  useEnabledHolderCount,
  useRolesRecord,
  useSaveRoles,
} from '#/features/subjects/repository/useAccess.ts';
import {
  accessRefusal,
  onlyHolderText,
  removalConfirmation,
  rolesRecord,
  splitRoles,
  subjectName,
  subjectTabHref,
  type Confirmation,
} from '#/features/subjects/service.ts';
import {
  administratorCapability,
  MANAGE_TENANTS,
  TENANT_ADMIN,
} from '#/shared/service/administrators.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { lacking } from '#/shared/service/access.ts';
import {
  beyondCaller,
  CAPABILITY_TEXT,
  ceilingOf,
  fullText,
  heldCapabilities,
  holdingLabel,
  holdingsIn,
  includedBy,
  isHolding,
  type Held,
  type Holding,
} from '#/shared/service/capabilities.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';

export function useSubjectRolesRead(tenant: string, id: string): RecordState<SetRolesResponse> {
  return useRolesRecord(tenant, id);
}

export interface CapabilityValues extends Readonly<Record<string, unknown>> {
  capabilities: readonly Holding[];
}

export interface CapabilityChoice {
  id: Holding;
  label: string;
  description: string;
  note: string | null;
  unavailable: string | null;
}

// A holding the subject has only through a group or a role that nests it,
// which only that group or role can take away.
export interface HeldElsewhere {
  label: string;
  through: string;
}

export interface CapabilityEditing {
  name: string;
  // False without manage-users: what is held is shown as text.
  canManage: boolean;
  // Held by the subject and not by the caller, which puts the subject out
  // of reach (ADR 0040); empty when it is within reach, or not yet known.
  beyond: readonly AdminCapability[];
  options: readonly CapabilityChoice[];
  elsewhere: readonly HeldElsewhere[];
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

function inOrder(tenant: string, chosen: Iterable<string>): Holding[] {
  const set = new Set(chosen);
  return holdingsIn(tenant).filter((holding) => set.has(holding));
}

function noteOf(carrier: Holding | null, held: Held | undefined): string | null {
  if (carrier !== null) return `Carried by ${holdingLabel(carrier)}.`;
  if (held === undefined || held.through.length === 0) return null;
  return `${held.direct ? 'Also held' : 'Held'} ${held.through.join(', ')}.`;
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
  const effective = useEffectiveRoles(tenant, subject.id);
  const adminRoles = useAdminRoleIds(tenant);
  const counted = administratorCapability(tenant);
  const enabledHolders = useEnabledHolderCount(tenant, counted);
  const saveRoles = useSaveRoles(tenant, subject.id);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const split = splitRoles(data.items);
  const caller = authority?.capabilities;
  const held: ReadonlyMap<Holding, Held> =
    effective.status === 'ready' ? heldCapabilities(effective.data.items) : new Map();
  const beyond = caller === undefined ? [] : beyondCaller([...held.keys()], caller);
  const canManage = allowed && lacking(authority, ['manage-users']).length === 0;

  const save = useSectionSave({
    tenant,
    record: rolesRecord(subject.id),
    section: 'capabilities',
    label: 'Admin capabilities',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    explain: accessRefusal(name, 'roles', self),
    fields: {
      capabilities: {
        value: inOrder(tenant, split.holdings),
        label: 'Admin capabilities',
        kind: 'plain',
        describe: (value) => {
          const named = Array.isArray(value) ? value.map(String).filter(isHolding) : [];
          return named.length === 0 ? 'none' : named.map(holdingLabel).join(', ');
        },
      },
    },
    save: async (gateway, { values, ifMatch }) => {
      const missing = values.capabilities.filter(
        (holding) => adminRoles.status !== 'ready' || !adminRoles.data.has(holding),
      );
      if (adminRoles.status !== 'ready' || missing.length > 0) {
        console.error(`console defect: no role id for ${missing.join(', ')} in ${tenant}`);
        return { ok: false, kind: 'defect' };
      }
      const ids = values.capabilities.flatMap((holding) => adminRoles.data.get(holding) ?? []);
      const result = await saveRoles(gateway, [...split.roleIds, ...ids], ifMatch);
      if (result.ok && self) reread();
      return result;
    },
  });

  const chosen = save.values.capabilities;
  const base = inOrder(tenant, split.holdings);
  const removed = base.filter((holding) => !chosen.includes(holding));
  // What else, beyond the boxes, keeps the counted capability with them.
  // Full counts too when a group or another role carries it, since the box
  // only takes away what is assigned here.
  const keptOtherwise =
    (held.get(counted)?.through ?? []).some((path) => path !== `within ${TENANT_ADMIN}`) ||
    (counted !== TENANT_ADMIN && (held.get('tenant-admin')?.through.length ?? 0) > 0);
  const carriers = [...new Set<Holding>(['tenant-admin', counted])].filter((holding) =>
    chosen.includes(holding),
  );
  const removesTenants =
    tenant === SYSTEM_TENANT &&
    base.some((holding) => holding === TENANT_ADMIN || holding === MANAGE_TENANTS) &&
    !chosen.some((holding) => holding === TENANT_ADMIN || holding === MANAGE_TENANTS) &&
    !keptOtherwise;
  const onlyHolder =
    subject.enabled &&
    held.has(counted) &&
    enabledHolders.status === 'ready' &&
    !enabledHolders.data.capped &&
    enabledHolders.data.count === 1 &&
    !keptOtherwise &&
    carriers.length === 1;

  const options = holdingsIn(tenant).map((holding): CapabilityChoice => {
    const ceiling = caller === undefined ? null : ceilingOf(tenant, holding, caller);
    const guarded =
      onlyHolder && carriers[0] === holding ? onlyHolderText(name, tenant, counted) : null;
    return {
      id: holding,
      label: holdingLabel(holding),
      description: holding === TENANT_ADMIN ? fullText(tenant) : CAPABILITY_TEXT[holding],
      note: noteOf(includedBy(holding, chosen), held.get(holding)),
      unavailable: ceiling ?? guarded,
    };
  });
  const elsewhere = [...held]
    .filter(([holding, how]) => {
      if (how.direct || includedBy(holding, chosen) !== null) return false;
      return how.through.some((path) => !path.startsWith('within '));
    })
    .map(([holding, how]) => ({ label: holdingLabel(holding), through: how.through.join(', ') }));

  const blocked =
    adminRoles.status === 'loading'
      ? 'The admin roles are still being read.'
      : adminRoles.status === 'failed'
        ? 'The admin roles could not be read, so nothing can be saved.'
        : save.blocked;

  return {
    name,
    canManage,
    beyond,
    options,
    elsewhere,
    groupsHref: subjectTabHref(tenant, subject.id, 'groups'),
    rolesHref: subjectTabHref(tenant, subject.id, 'roles'),
    rolesFailed: adminRoles.status === 'failed' ? { retry: adminRoles.retry } : null,
    save: {
      ...save,
      blocked,
      submit: () => {
        if (blocked !== undefined) return false;
        const asked = removalConfirmation({ name, self, removed, removesTenants });
        if (asked === null) return save.submit();
        setConfirming(asked);
        return true;
      },
    },
    choose: (value) => {
      save.edit('capabilities', inOrder(tenant, value));
    },
    confirming,
    confirm: () => {
      setConfirming(null);
      save.submit();
    },
    cancel: () => {
      setConfirming(null);
    },
  };
}
