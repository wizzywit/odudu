import { type Read } from '#/shared/services/read';

export function rolesFailure(read: Read<unknown>): { retry: () => void } | null {
  return read.status === 'failed' ? { retry: read.retry } : null;
}

export function adminRolesBlocked(
  status: 'loading' | 'ready' | 'failed',
  blocked: string | undefined,
): string | undefined {
  if (status === 'loading') return 'The admin roles are still being read.';
  if (status === 'failed') return 'The admin roles could not be read, so nothing can be saved.';
  return blocked;
}
