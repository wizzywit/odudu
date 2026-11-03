export const FAILURE_KICKER = 'Unexpected error';
export const FAILURE_TITLE = 'Something went wrong';

export const ROUTE_FAILURE_TEXT =
  'This page could not be shown. The rest of the console is still here. Changes you saved are kept; changes you had not saved on this page cannot be recovered.';
export const SHELL_FAILURE_TEXT =
  'The console could not draw this page or the menu around it. Reloading starts it again.';
export const ROOT_FAILURE_TEXT =
  'The console stopped before it could show this page. Reloading starts it again.';

export const TRY_AGAIN_LABEL = 'Try again';
export const BACK_TO_OVERVIEW_LABEL = 'Back to overview';
export const RELOAD_LABEL = 'Reload the console';

export const DETAILS_HEADING = 'Quote this when you report the problem';
// CopyValue says "Copy error details" to a screen reader and "Copy" on the button.
export const DETAILS_LABEL = 'error details';
export const MESSAGE_LABEL = 'Message, shown in a development build only';

// What the shared panel is told to say, in every place it is drawn.
export const PANEL_WORDING = {
  kicker: FAILURE_KICKER,
  title: FAILURE_TITLE,
  detailsHeading: DETAILS_HEADING,
  detailsLabel: DETAILS_LABEL,
} as const;
