// Every word the assistant's entry draws, under a stable id.
export const ASSISTANT_WORDING = {
  openButton: 'Ask the assistant',
  openButtonShort: 'Ask',
  panelTitle: 'Assistant',
  panelLabel: 'Assistant panel',
  closeButton: 'Close',
  imageNotShown: 'Image not shown.',
  tooLongToShow: 'Shown in part. The rest is too long to display.',
  rowsNotShown: 'Some rows are not shown.',
  shortcutLead: 'or press',
} as const;

export type AssistantWordingId = keyof typeof ASSISTANT_WORDING;
