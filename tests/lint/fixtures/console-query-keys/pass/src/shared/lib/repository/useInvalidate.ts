import type { QueryClient } from '@tanstack/react-query';

export function invalidate(client: QueryClient, queryKey: readonly unknown[]): void {
  client.invalidateQueries({ queryKey });
}
