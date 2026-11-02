import { useState } from 'react';

// A save asked about before it is sent: `ask` keeps what the dialog says,
// `confirm` closes it and sends the save, `cancel` closes it.
export function useSaveConfirmation<C>(save: { submit: () => boolean }) {
  const [confirming, setConfirming] = useState<C | null>(null);
  return {
    confirming,
    ask: (what: C): void => {
      setConfirming(what);
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
