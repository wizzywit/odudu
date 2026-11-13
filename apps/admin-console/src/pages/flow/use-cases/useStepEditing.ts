import type { ExecutionRequirement } from '#/pages/flow/types/executions';
import { useState } from 'react';
import { DEFAULT_ADDED, requirementOf } from '#/pages/flow/services/requirement';
import { offeredOptions, stepRows, type StepRow } from '#/pages/flow/services/stepRows';
import {
  addable,
  added,
  chosenAddition,
  moved,
  withRequirement,
  type Direction,
  type Step,
} from '#/pages/flow/services/steps';

export interface StepEditing {
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

// The edits of an ordered list of steps, handed to whichever section saves it.
export function useStepEditing({
  steps,
  available,
  reading,
  edit,
}: {
  steps: readonly Step[];
  available: readonly string[];
  // Whom the one-time password step asks, shown on that step.
  reading: string | null;
  edit: (next: Step[]) => void;
}): StepEditing {
  const [picked, setPicked] = useState('');
  const [addingRequirement, setAddingRequirement] = useState<ExecutionRequirement>(DEFAULT_ADDED);
  const offered = addable(available, steps);
  const adding = chosenAddition(offered, picked);
  return {
    rows: stepRows(steps, reading),
    move: (authenticator, direction) => {
      edit(moved(steps, authenticator, direction));
    },
    setRequirement: (authenticator, requirement) => {
      edit(withRequirement(steps, authenticator, requirementOf(requirement)));
    },
    offered: offeredOptions(offered),
    adding,
    addingRequirement,
    chooseAddition: setPicked,
    chooseAdditionRequirement: (requirement) => {
      setAddingRequirement(requirementOf(requirement));
    },
    add: () => {
      edit(added(steps, adding, addingRequirement));
    },
  };
}
