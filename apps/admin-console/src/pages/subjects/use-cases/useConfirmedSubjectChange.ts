import { useRefusal } from '#/entities/session';
import { useToast } from '#/shared/lib/repository/useToasts';
import type { Write } from '#/shared/lib/repository/useWrite';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useConfirmedChange, type Confirming } from '#/shared/lib/use-cases/useConfirmedChange';
import { changeFailureText } from '#/shared/lib/services/failure';

// A change to a subject behind a plain confirmation, its success said in a toast.
export function useConfirmedSubjectChange<A, R>({
  tenant,
  capability,
  change,
  done,
}: {
  tenant: string;
  capability: AdminCapability;
  change: Write<A, GatewayResult<R>>;
  done: (arg: A, data: R) => string;
}): Confirming<A> {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  return useConfirmedChange({
    refusal,
    capability,
    change,
    failureText: (failure) => changeFailureText(failure, capability),
    done: (arg, data) => {
      toast.succeeded(done(arg, data));
    },
  });
}
