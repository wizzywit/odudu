import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useNow } from '#/shared/usecase/useNow.ts';
import { useRotateSecret } from '#/features/clients/repository/useRotateSecret.ts';
import {
  previousSecretLine,
  type PreviousSecret,
  rotatedNote,
  rotatedTitle,
  rotateConsequence,
  rotationFailureText,
} from '#/features/clients/service';

export interface ClientSecret {
  // What became of the secret the last rotation replaced, or null.
  previous: PreviousSecret | null;
  grace: number;
  setGrace: (seconds: number) => void;
  confirming: boolean;
  consequence: string;
  busy: boolean;
  // What the last rotation said when it did not finish, or null.
  problem: string | null;
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  secretTitle: string;
  secretNote: string;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
  closeSecret: () => void;
}

// Fresh to within half a minute, as a timestamp's own reading is.
const NOW_MS = 30_000;

export function useClientSecret(tenant: string, client: Client): ClientSecret {
  const rotation = useRotateSecret(tenant, client.id);
  const now = useNow(NOW_MS);
  const [grace, setGrace] = useState(0);
  const [confirming, setConfirming] = useState(false);
  return {
    previous: previousSecretLine(client.previous_secret_expires_at, now),
    grace,
    setGrace,
    confirming,
    consequence: rotateConsequence(client.name, grace),
    busy: rotation.busy,
    problem: rotation.failure === null ? null : rotationFailureText(rotation.failure, client.name),
    secret: rotation.secret,
    secretTitle: rotatedTitle(client.name),
    secretNote: rotatedNote(client.name, grace),
    ask: () => {
      setConfirming(true);
    },
    cancel: () => {
      setConfirming(false);
    },
    confirm: () => {
      setConfirming(false);
      rotation.start({ grace });
    },
    closeSecret: rotation.close,
  };
}
