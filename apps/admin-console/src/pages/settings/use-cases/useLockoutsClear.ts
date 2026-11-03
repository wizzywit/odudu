import { useState } from 'react';
import { useAuthority, useRefusal } from '#/entities/session';
import { useLockoutsClear } from '#/pages/settings/repository/useLockoutsClear';
import {
  clearWords,
  clearedText,
  clearMoreText,
  clearFailure,
  lockoutClearState,
  type ClearWords,
  type LockoutClearState,
} from '#/pages/settings/services/lockoutClear';
import { LOCKOUTS_NEEDS } from '#/pages/settings/services/lockouts';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

export interface LockoutsClear extends Removal {
  state: LockoutClearState;
  words: ClearWords;
  // What stays beside the button while more lockouts are left.
  more: string | null;
}

export function useLockoutsClearAction(tenant: string): LockoutsClear {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const [more, setMore] = useState<string | null>(null);
  const removal = useConfirmedRemoval({
    refusal,
    capability: LOCKOUTS_NEEDS,
    change: useLockoutsClear(tenant),
    failureText: (failure) => clearFailure(tenant, failure),
    done: (answer) => {
      toast.succeeded(clearedText(tenant, answer));
      setMore(clearMoreText(tenant, answer));
    },
  });
  return {
    ...removal,
    state: lockoutClearState(useAuthority(tenant)),
    words: clearWords(tenant),
    more,
  };
}
