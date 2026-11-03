import type { QueryClient } from '@tanstack/react-query';

export function reread(client: QueryClient): void {
  client.invalidateQueries({
    predicate: ({ queryKey: [kind, at] }) => kind === 'list' && at === 'a',
  });
}
