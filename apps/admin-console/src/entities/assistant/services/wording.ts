// Every word the assistant's entry draws, under a stable id.
export const ASSISTANT_WORDING = {
  openButton: 'Ask the assistant',
  openButtonShort: 'Ask',
  panelTitle: 'Assistant',
  panelLabel: 'Assistant panel',
  closeButton: 'Close',
  shortcutLead: 'or press',
} as const;

export type AssistantWordingId = keyof typeof ASSISTANT_WORDING;
