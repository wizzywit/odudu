import type { FlowWire } from '#/pages/flow/types/flows';
import { useRefusal } from '#/entities/session';
import { flowRecordName } from '#/entities/flow';
import { explainFlowSave } from '#/pages/flow/services/flows';
import { useFlowSave, type FlowValues } from '#/pages/flow/repository/useFlows';
import { flowOutcome } from '#/pages/flow/services/refusal';
import { describeSteps, flowStepsOf } from '#/pages/flow/services/steps';
import { useStepEditing, type StepEditing } from '#/pages/flow/use-cases/useStepEditing';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';

export type FlowEditor = StepEditing & { save: SectionSave<FlowValues> };

// One flow's name and steps, saved together because the server replaces them whole.
export function useFlowEditor({
  tenant,
  flow,
  etag,
  gone,
  available,
}: {
  tenant: string;
  flow: FlowWire;
  etag: string;
  gone: boolean;
  available: readonly string[];
}): FlowEditor {
  const refusal = useRefusal(tenant);
  const saveFlow = useFlowSave(tenant, flow.id);
  const save = useSectionSave({
    tenant,
    record: flowRecordName(flow.id),
    section: 'flow',
    label: flow.name,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: (problem) => explainFlowSave(problem, writeRefusal),
    fields: {
      name: { value: flow.name, label: 'Name', kind: 'plain' },
      steps: {
        value: flowStepsOf(flow.steps),
        label: 'Steps',
        kind: 'plain',
        describe: describeSteps,
      },
    },
    save: async (gateway, input) =>
      flowOutcome(await saveFlow(gateway, input), input.values.steps, available),
  });
  const editing = useStepEditing({
    steps: save.values.steps,
    available,
    reading: null,
    edit: (next) => {
      save.edit('steps', next);
    },
  });
  return { ...editing, save };
}
