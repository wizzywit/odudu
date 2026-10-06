import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRotateSecret } from '#/features/clients/repository/useRotateSecret.ts';
import {
  rotatedNote,
  rotatedTitle,
  rotateConsequence,
  rotationFailureText,
} from '#/features/clients/service';

export interface ClientSecret {
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

export function useClientSecret(tenant: string, client: Client): ClientSecret {
  const rotation = useRotateSecret(tenant, client.id);
  const [grace, setGrace] = useState(0);
  const [confirming, setConfirming] = useState(false);
  return {
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
