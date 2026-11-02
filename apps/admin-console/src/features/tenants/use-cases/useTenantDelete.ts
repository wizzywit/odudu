import { useAuthority, useRefusal } from '#/entities/session';
import { useTenantDeletion } from '#/features/tenants/repository/useTenantDeletion';
import { TENANTS_HREF } from '#/features/tenants/services/address';
import {
  DELETE_NEEDS,
  deleteConsequence,
  deleteFailure,
  deleteState,
  type DeleteState,
} from '#/features/tenants/services/deletion';
import { useGo } from '#/shared/repository/useGo';
import { useToast } from '#/shared/repository/useToasts';
import { lacking } from '#/shared/services/access';
import { deletedText } from '#/shared/services/failure';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';

export interface TenantDelete extends Removal {
  state: DeleteState;
  consequence: string;
}

// Leaves for the list once the tenant is gone: its record no longer exists.
export function useTenantDelete(name: string, enabled: boolean): TenantDelete {
  const refusal = useRefusal(SYSTEM_TENANT);
  const toast = useToast();
  const go = useGo();
  const missing = lacking(useAuthority(SYSTEM_TENANT), DELETE_NEEDS);
  const removal = useConfirmedRemoval({
    refusal,
    capability: 'manage-tenants',
    change: useTenantDeletion(name),
    failureText: (failure) => deleteFailure(name, failure),
    done: () => {
      toast.succeeded(deletedText(name));
      go(TENANTS_HREF, { replace: true });
    },
  });
  return {
    ...removal,
    state: deleteState({ name, enabled, missing }),
    consequence: deleteConsequence(name),
  };
}
