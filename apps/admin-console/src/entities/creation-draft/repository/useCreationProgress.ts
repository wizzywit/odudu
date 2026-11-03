import { useEffect, useState } from 'react';
import { storeCreation } from '#/entities/creation-draft/adapter/creationStorage';
import { freshCreation } from '#/entities/creation-draft/services/creationDraft';
import { ownCreation } from '#/entities/creation-draft/repository/storedCreation';
import type { Creation, CreationFlow } from '#/entities/creation-draft/types/creation';

export interface CreationProgress {
  creation: Creation;
  update: (creation: Creation) => void;
}

// Kept in this tab's storage on every change, so a reload resumes it.
export function useCreationProgress(owner: string, flow: CreationFlow): CreationProgress {
  const [creation, setCreation] = useState<Creation>(
    () => ownCreation(owner, flow) ?? freshCreation(flow),
  );
  // A finished creation survives a reload, which runs no cleanup, but not
  // leaving the page: the next "Create a tenant" starts a new one.
  useEffect(() => {
    if (creation.step !== 'done') return undefined;
    storeCreation(owner, creation, flow);
    return () => {
      if (ownCreation(owner, flow)?.step === 'done') storeCreation(owner, null, flow);
    };
  }, [owner, flow, creation]);
  return {
    creation,
    update: (next) => {
      storeCreation(owner, next, flow);
      setCreation(next);
    },
  };
}
