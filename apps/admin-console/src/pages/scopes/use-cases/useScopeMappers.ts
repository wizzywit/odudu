import type { ScopeMappers } from '#/pages/scopes/types/scopeMappers';
import { useRefusal } from '#/entities/session';
import {
  useScopeMappersRecord,
  useScopeSaves,
  type MapperValues,
} from '#/pages/scopes/repository/useScopeRecord';
import {
  boundAfter,
  mapperChecklist,
  mappersFailure,
  mappersSummary,
  type MapperOption,
} from '#/pages/scopes/services/mappers';
import { scopeMappersRecord } from '#/pages/scopes/services/tabs';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { namesOrNone } from '#/shared/lib/services/format';
import { inOrderOf } from '#/shared/lib/services/ids';

export function useScopeMappersRead(tenant: string, id: string): RecordState<ScopeMappers> {
  return useScopeMappersRecord(tenant, id);
}

export interface ScopeMapperSet {
  save: SectionSave<MapperValues>;
  options: readonly MapperOption[];
  // What the list shows ticked: the bound mappers, or the defaults used while none is.
  value: readonly string[];
  summary: string;
  choose: (names: readonly string[]) => void;
}

export function useScopeMapperSet({
  tenant,
  id,
  data,
  etag,
  gone,
}: {
  tenant: string;
  id: string;
  data: ScopeMappers;
  etag: string;
  gone: boolean;
}): ScopeMapperSet {
  const refusal = useRefusal(tenant);
  const saves = useScopeSaves(tenant, id);
  const save = useSectionSave({
    tenant,
    record: scopeMappersRecord(id),
    section: 'mappers',
    label: 'Claim mappers',
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      mapper_names: {
        value: inOrderOf(data.available, data.bound),
        label: 'Claim mappers',
        kind: 'plain',
        describe: namesOrNone,
      },
    },
    save: async (gateway, input) => {
      const result = await saves.mappers(gateway, input);
      return result.ok ? result : mappersFailure(result);
    },
  });
  const checklist = mapperChecklist(data.available, data.declared, save.values.mapper_names);
  return {
    save,
    options: checklist.options,
    value: checklist.value,
    summary: mappersSummary(data.bound, data.declared),
    choose: (names) => {
      save.edit(
        'mapper_names',
        boundAfter(data.available, data.declared, save.values.mapper_names, names),
      );
    },
  };
}
