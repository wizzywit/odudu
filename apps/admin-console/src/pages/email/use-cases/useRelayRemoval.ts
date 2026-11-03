import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useSmtpRemove } from '#/pages/email/repository/useSmtpWrites';
import { EMAIL_WORDS, type EmailWords } from '#/pages/email/services/emailWords';
import { removeOutcome } from '#/pages/email/services/remove';
import { useToast } from '#/shared/repository/useToasts';

export interface RelayRemoval {
  words: EmailWords['remove'];
  confirming: boolean;
  busy: boolean;
  // What the last attempt said, shown where it was made.
  message: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export function useRelayRemoval(tenant: string, reread: () => void): RelayRemoval {
  const remove = useSmtpRemove(tenant);
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return {
    words: EMAIL_WORDS.remove,
    confirming,
    busy: remove.busy,
    message,
    ask: () => {
      setMessage(null);
      setConfirming(true);
    },
    cancel: () => {
      setConfirming(false);
    },
    confirm: () => {
      if (remove.busy) return;
      remove
        .run()
        .then((result) => {
          const outcome = removeOutcome(result);
          setConfirming(false);
          setMessage(outcome.text);
          if (!result.ok) refusal.report(result, 'manage-tenant');
          if (outcome.done) {
            toast.succeeded(outcome.text);
            reread();
          }
        })
        .catch(() => {
          setConfirming(false);
          setMessage(removeOutcome({ ok: false, kind: 'defect' }).text);
        });
    },
  };
}
