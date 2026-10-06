import { useHeldCapabilities } from '#/features/subjects/repository/useAccess.ts';

// The admin capabilities a subject holds, whole, for a page of another
// record whose writes are held to that subject's ceiling, such as a client's
// service account. Nothing is asked for none.
export function useSubjectHeld(tenant: string, id: string | null) {
  return useHeldCapabilities(tenant, id ?? '', id !== null);
}
