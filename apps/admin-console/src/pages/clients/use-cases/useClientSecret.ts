import type { Client } from '#/entities/client';
import { useState } from 'react';
import { useNow } from '#/shared/use-cases/useNow';
import { useRotateSecret } from '#/pages/clients/repository/useRotateSecret';
import { SECTIONS_ADVANCED } from '#/pages/clients/services/clientSections';
import {
  GRACE_LABEL,
  GRACE_MAX,
  GRACE_RULE,
  previousSecretLine,
  SECRET_RULE,
  secretFixedNote,
  type PreviousSecret,
  rotatedNote,
  rotatedTitle,
  rotateConsequence,
  rotationProblem,
} from '#/pages/clients/services/secretRotation';

export interface ClientSecret {
  title: string;
  rule: string;
  // Why the secret cannot be rotated on this client, or null.
  fixed: string | null;
  graceLabel: string;
  graceRule: string;
  graceMax: number;
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
    title: SECTIONS_ADVANCED.secret,
    rule: SECRET_RULE,
    fixed: secretFixedNote(client),
    graceLabel: GRACE_LABEL,
    graceRule: GRACE_RULE,
    graceMax: GRACE_MAX,
    previous: previousSecretLine(client.previous_secret_expires_at, now),
    grace,
    setGrace,
    confirming,
    consequence: rotateConsequence(client.name, grace),
    busy: rotation.busy,
    problem: rotationProblem(rotation.failure, client.name),
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
