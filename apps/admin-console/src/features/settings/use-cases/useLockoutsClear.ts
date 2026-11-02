import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useLockoutsClear } from '#/features/settings/repository/useLockoutsClear';
import {
  clearConsequence,
  clearedText,
  clearMoreText,
  clearFailure,
  lockoutClearState,
  LOCKOUTS_NEEDS,
  type LockoutClearState,
} from '#/features/settings/services';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

export interface LockoutsClear extends Removal {
  state: LockoutClearState;
  consequence: string;
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
    consequence: clearConsequence(tenant),
    more,
  };
}
