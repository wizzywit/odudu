import type { AssistantView } from '#/entities/assistant';

export interface ModelEntry {
  slot: string;
  model: string;
}

// The models to name in the header: the slots and what runs in each, only
// where the deployment has more than one model, since a single one is not a
// choice and needs no mention beyond the first-run notice.
export function modelsOf(view: AssistantView): ModelEntry[] | null {
  const { slots, modelChoices } = view;
  if (slots === undefined || modelChoices === undefined || modelChoices.length < 2) return null;
  return [
    { slot: 'fast', model: slots.fast },
    { slot: 'standard', model: slots.standard },
    { slot: 'deep', model: slots.deep },
  ];
}
