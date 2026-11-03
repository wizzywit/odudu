import { useBuiltinScopes, useRestoreBuiltins } from '#/pages/scopes/repository/useScopeRecord';
import {
  RESTORE_CONFIRM_LABEL,
  RESTORE_DIALOG_TITLE,
  restoredText,
  restoreFailureText,
  restoreHeld,
  restoreOffer,
  restoreText,
} from '#/pages/scopes/services/restore';
import { useRefusal } from '#/entities/session';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval } from '#/shared/use-cases/useConfirmedChange';

export interface RestoreScopes {
  title: string;
  confirmLabel: string;
  open: boolean;
  busy: boolean;
  problem: string | null;
  // What the dialog says: what is missing, or that nothing is.
  text: string;
  // True unless something is known to be missing, so a press could only do nothing.
  held: boolean;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export function useRestoreScopes(tenant: string): RestoreScopes {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const restore = useRestoreBuiltins(tenant);
  const asking = useConfirmedRemoval({
    refusal,
    capability: 'manage-tenant',
    change: restore,
    failureText: restoreFailureText,
    done: (data) => {
      toast.succeeded(restoredText(data.created));
    },
  });
  const offer = restoreOffer(useBuiltinScopes(tenant, asking.confirming));
  return {
    title: RESTORE_DIALOG_TITLE,
    confirmLabel: RESTORE_CONFIRM_LABEL,
    open: asking.confirming,
    busy: asking.busy,
    problem: asking.problem,
    text: restoreText(offer),
    held: restoreHeld(offer),
    ask: asking.ask,
    cancel: asking.cancel,
    confirm: asking.confirm,
  };
}
