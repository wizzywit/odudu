import type { ReactNode } from 'react';
import type { ListStatus } from '#/shared/lib/services/resourceList';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { LoadFailed } from '#/shared/ui/LoadFailed';

// A list read before anything is drawn: its placeholder while it loads, a
// note naming the capability it needs when the gateway refused it, the failure
// with its retry, and otherwise what the page draws for rows, an empty list
// or a narrowed one, drawn only then. Without `refused` a refusal reads as any
// other failure.
export function ListGate({
  list,
  loading,
  refused,
  failed,
  unchanged = false,
  children,
}: {
  list: { status: ListStatus; retry: () => void };
  loading: ReactNode;
  // The capability, and what the list is called in "Sessions needs the ... capability".
  refused?: { capability: string; noun: string };
  // The failure's title: "The sessions could not be loaded".
  failed: string;
  unchanged?: boolean;
  children: () => ReactNode;
}) {
  switch (list.status) {
    case 'loading':
      return loading;
    case 'refused':
      if (refused !== undefined) {
        return <CapabilityNote capability={refused.capability}>{refused.noun}</CapabilityNote>;
      }
      return <LoadFailed title={failed} retry={list.retry} unchanged={unchanged} />;
    case 'failed':
      return <LoadFailed title={failed} retry={list.retry} unchanged={unchanged} />;
    case 'ready':
      return children();
  }
}
