// Every word the assistant's entry draws, under a stable id.
export const ASSISTANT_WORDING = {
  openButton: 'Ask the assistant',
  panelTitle: 'Assistant',
  panelLabel: 'Assistant panel',
  closeButton: 'Close',
  imageNotShown: 'Image not shown.',
  tooLongToShow: 'Shown in part. The rest is too long to display.',
  shortcutLead: 'or press',
} as const;

export type AssistantWordingId = keyof typeof ASSISTANT_WORDING;
