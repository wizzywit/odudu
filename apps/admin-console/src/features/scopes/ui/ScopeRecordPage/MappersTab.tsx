import type { Scope } from '#/entities/scope';
import {
  useScopeMapperSet,
  useScopeMappersRead,
  type ScopeMapperSet,
} from '#/features/scopes/use-cases/useScopeMappers';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';

function Mappers({ name, set }: { name: string; set: ScopeMapperSet }) {
  const s = set.save;
  return (
    <SaveSection
      title="Claim mappers"
      description={`The mappers that build the claims a token granted ${name} carries.`}
      save={s}
    >
      <p className={recordTab.rule}>{set.summary}</p>
      <ChecklistField
        label="Bound mappers"
        options={set.options}
        value={set.value}
        error={s.fieldErrors.mapper_names}
        changed={s.changed.includes('mapper_names')}
        onChange={set.choose}
      />
    </SaveSection>
  );
}

function Ready({
  tenant,
  scope,
  ...read
}: {
  tenant: string;
  scope: Scope;
  data: Parameters<typeof useScopeMapperSet>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const set = useScopeMapperSet({ tenant, id: scope.id, ...read });
  return <Mappers name={scope.name} set={set} />;
}

export function MappersTab({ tenant, scope }: { tenant: string; scope: Scope }) {
  const read = useScopeMappersRead(tenant, scope.id);
  return (
    <ReadGate
      read={read}
      label="Loading the mappers"
      fields={2}
      failed="The claim mappers could not be loaded"
    >
      {(data, etag) => (
        <div className={recordTab.tab}>
          <Ready tenant={tenant} scope={scope} data={data} etag={etag} gone={read.gone} />
        </div>
      )}
    </ReadGate>
  );
}
