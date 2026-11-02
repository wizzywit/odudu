import type { ExecutionRequirement, ListExecutionsResponse } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { flowSaves, FLOW_RECORD, type StepValues } from '#/features/flow/repository/useFlowRecord';
import {
  addable,
  added,
  canMove,
  chosenAddition,
  describeSteps,
  FLOW_TITLE,
  flowOutcome,
  DEFAULT_ADDED,
  requirementOf,
  moved,
  stepsOf,
  withRequirement,
  type Direction,
  type Step,
} from '#/features/flow/services';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/services/capabilities';

export interface FlowSteps {
  save: SectionSave<StepValues>;
  steps: readonly Step[];
  canMove: (authenticator: string, direction: Direction) => boolean;
  move: (authenticator: string, direction: Direction) => void;
  setRequirement: (authenticator: string, requirement: string) => void;
  // What the registry offers that is not yet a step.
  offered: readonly string[];
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
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
}): FlowSteps {
  const refusal = useRefusal(tenant);
  const saves = flowSaves(tenant);
  const [picked, setPicked] = useState('');
  const [addingRequirement, setAddingRequirement] = useState<ExecutionRequirement>(DEFAULT_ADDED);
  const save = useSectionSave({
    tenant,
    record: FLOW_RECORD,
    section: 'steps',
    label: FLOW_TITLE,
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
    steps,
    canMove: (authenticator, direction) => canMove(steps, authenticator, direction),
    move: (authenticator, direction) => {
      save.edit('steps', moved(steps, authenticator, direction));
    },
    setRequirement: (authenticator, requirement) => {
      save.edit('steps', withRequirement(steps, authenticator, requirementOf(requirement)));
    },
    offered,
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
