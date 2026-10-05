import type { SetRolesResponse, Subject } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import {
  useAdminRoleIds,
  useEffectiveRoles,
  useRolesRecord,
  useSaveRoles,
} from '#/features/subjects/repository/useAccess.ts';
import {
  accessRefusal,
  rolesRecord,
  splitRoles,
  subjectName,
} from '#/features/subjects/service.ts';
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
import type { AdminCapability } from '#/shared/service/principal.ts';

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

export interface CapabilityEditing {
  name: string;
  // False without manage-users: what is held is shown as text.
  canManage: boolean;
  // Held by the subject and not by the caller, which puts the subject out
  // of reach (ADR 0040); empty when it is within reach, or not yet known.
  beyond: readonly AdminCapability[];
  options: readonly CapabilityChoice[];
  save: SectionSave<CapabilityValues>;
  choose: (holdings: readonly string[]) => void;
}

function inOrder(tenant: string, chosen: Iterable<string>): Holding[] {
  const set = new Set(chosen);
  return holdingsIn(tenant).filter((holding) => set.has(holding));
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
}: {
  tenant: string;
  subject: Subject;
  data: SetRolesResponse;
  etag: string;
  gone: boolean;
  authorityTenant?: string;
}): CapabilityEditing {
  const name = subjectName(subject);
  const authority = useAuthority(authorityTenant);
  const refusal = useRefusal(authorityTenant);
  const effective = useEffectiveRoles(tenant, subject.id);
  const adminRoles = useAdminRoleIds(tenant);
  const saveRoles = useSaveRoles(tenant, subject.id);
  const split = splitRoles(data.items);
  const caller = authority?.capabilities;
  const held: ReadonlyMap<Holding, Held> =
    effective.status === 'ready' ? heldCapabilities(effective.data.items) : new Map();
  const beyond = caller === undefined ? [] : beyondCaller([...held.keys()], caller);
  const canManage = lacking(authority, ['manage-users']).length === 0;

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
    explain: accessRefusal(name, 'roles'),
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
    save: (gateway, { values, ifMatch }) => {
      if (adminRoles.status !== 'ready') {
        console.error('console defect: admin capabilities saved before their roles were read');
        return Promise.resolve({ ok: false as const, kind: 'defect' as const });
      }
      const ids = values.capabilities.flatMap((holding) => {
        const id = adminRoles.data.get(holding);
        return id === undefined ? [] : [id];
      });
      return saveRoles(gateway, [...split.roleIds, ...ids], ifMatch);
    },
  });

  const chosen = save.values.capabilities;
  const options = holdingsIn(tenant).map((holding): CapabilityChoice => {
    const carrier = includedBy(holding, chosen);
    const through = held.get(holding)?.through ?? [];
    let note: string | null = null;
    if (carrier !== null) note = `Carried by ${holdingLabel(carrier)}.`;
    else if (through.length > 0) note = `Also held ${through.join(', ')}.`;
    return {
      id: holding,
      label: holdingLabel(holding),
      description: holding === 'tenant-admin' ? fullText(tenant) : CAPABILITY_TEXT[holding],
      note,
      unavailable: caller === undefined ? null : ceilingOf(tenant, holding, caller),
    };
  });

  return {
    name,
    canManage,
    beyond,
    options,
    save,
    choose: (value) => {
      save.edit('capabilities', inOrder(tenant, value));
    },
  };
}
