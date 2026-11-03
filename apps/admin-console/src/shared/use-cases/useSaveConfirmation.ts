import { useState } from 'react';

// A save asked about before it is sent. `submitOrAsk` keeps what the dialog
// says, or sends the save when there is nothing to ask; `confirm` closes the
// dialog and sends the save, `cancel` closes it. `whenAsked` is what the
// section is told when a question was asked in place of the send: false lets
// its next press submit, true keeps its guard against a second submit up.
export function useSaveConfirmation<C>(save: { submit: () => boolean }) {
  const [confirming, setConfirming] = useState<C | null>(null);
  return {
    confirming,
    submitOrAsk: (asked: C | null, { whenAsked }: { whenAsked: boolean }): boolean => {
      if (asked === null) return save.submit();
      setConfirming(asked);
      return whenAsked;
    },
    confirm: (): void => {
      setConfirming(null);
      save.submit();
    },
    cancel: (): void => {
      setConfirming(null);
    },
  };
}
