import type { ExecutionRequirement, ListExecutionsResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { flowSaves, FLOW_RECORD, type StepValues } from '#/features/flow/repository/useFlowRecord';
import { flowOutcome } from '#/features/flow/services/refusal';
import { flowArea } from '#/features/flow/services/flowWording';
import { DEFAULT_ADDED, requirementOf } from '#/features/flow/services/requirement';
import { offeredOptions, stepRows, type StepRow } from '#/features/flow/services/stepRows';
import {
  addable,
  added,
  chosenAddition,
  describeSteps,
  moved,
  stepsOf,
  withRequirement,
  type Direction,
} from '#/features/flow/services/steps';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/services/capabilities';

export interface FlowSteps {
  save: SectionSave<StepValues>;
  rows: readonly StepRow[];
  move: (authenticator: string, direction: Direction) => void;
  setRequirement: (authenticator: string, requirement: string) => void;
  // What the registry offers that is not yet a step.
  offered: readonly { id: string; label: string }[];
  adding: string;
  addingRequirement: ExecutionRequirement;
  chooseAddition: (authenticator: string) => void;
  chooseAdditionRequirement: (requirement: string) => void;
  add: () => void;
}

export function useFlowSteps({
  tenant,
  data,
  etag,
  gone,
  reading,
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
  // Whom the one-time password step asks, shown on that step.
  reading: string | null;
}): FlowSteps {
  const refusal = useRefusal(tenant);
  const saves = flowSaves(tenant);
  const [picked, setPicked] = useState('');
  const [addingRequirement, setAddingRequirement] = useState<ExecutionRequirement>(DEFAULT_ADDED);
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
      flowOutcome(await saves.steps(gateway, input), input.values.steps, data.available),
  });
  const steps = save.values.steps;
  const offered = addable(data.available, steps);
  const adding = chosenAddition(offered, picked);
  return {
    save,
    rows: stepRows(steps, reading),
    move: (authenticator, direction) => {
      save.edit('steps', moved(steps, authenticator, direction));
    },
    setRequirement: (authenticator, requirement) => {
      save.edit('steps', withRequirement(steps, authenticator, requirementOf(requirement)));
    },
    offered: offeredOptions(offered),
    adding,
    addingRequirement,
    chooseAddition: setPicked,
    chooseAdditionRequirement: (requirement) => {
      setAddingRequirement(requirementOf(requirement));
    },
    add: () => {
      save.edit('steps', added(steps, adding, addingRequirement));
    },
  };
}
