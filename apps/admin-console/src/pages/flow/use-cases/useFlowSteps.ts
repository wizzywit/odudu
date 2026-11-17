import type { ListExecutionsResponse } from '#/pages/flow/types/executions';
import { useRefusal } from '#/entities/session';
import { flowSaves, FLOW_RECORD, type StepValues } from '#/pages/flow/repository/useFlowRecord';
import { useAfterDefaultSave } from '#/pages/flow/repository/useFlows';
import { flowOutcome } from '#/pages/flow/services/refusal';
import { flowArea } from '#/pages/flow/services/flowWording';
import { describeSteps, stepsOf } from '#/pages/flow/services/steps';
import { useStepEditing, type StepEditing } from '#/pages/flow/use-cases/useStepEditing';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';

export type FlowSteps = StepEditing & { save: SectionSave<StepValues> };

export function useFlowSteps({
  tenant,
  data,
  etag,
  gone,
  reading,
  tenantSettings,
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
  // Whom the one-time password step asks, shown on that step.
  reading: string | null;
  tenantSettings: Readonly<Record<string, unknown>> | undefined;
}): FlowSteps {
  const refusal = useRefusal(tenant);
  const saves = flowSaves(tenant);
  const after = useAfterDefaultSave(tenant);
  const save = useSectionSave({
    tenant,
    record: FLOW_RECORD,
    section: 'steps',
    label: flowArea().title,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      steps: {
        value: stepsOf(data.items),
        label: 'Steps',
        kind: 'plain',
        describe: describeSteps,
      },
    },
    save: async (gateway, input) =>
      flowOutcome(after(await saves.steps(gateway, input)), input.values.steps, data.available),
  });
  const editing = useStepEditing({
    steps: save.values.steps,
    available: data.available,
    reading,
    tenantSettings,
    edit: (next) => {
      save.edit('steps', next);
    },
  });
  return { ...editing, save };
}
