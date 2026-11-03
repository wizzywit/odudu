import type { ReactNode } from 'react';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { FormSkeleton } from '#/shared/ui/Skeleton';

// A record the page edits, read before anything is drawn: a form-shaped
// placeholder while it loads, the failure with its retry, and otherwise the
// record with the ETag to save against. Whether it is gone stays on `read`.
export function ReadGate<R>({
  read,
  label,
  fields,
  failed,
  children,
}: {
  read: {
    status: string;
    data: R | undefined;
    etag: string | null;
    gone: boolean;
    retry: () => void;
  };
  // What the placeholder is announced as: "Loading the groups".
  label: string;
  fields: number;
  // The failure's title: "The groups could not be loaded".
  failed: string;
  children: (data: R, etag: string) => ReactNode;
}) {
  if (read.status === 'loading') return <FormSkeleton label={label} fields={fields} />;
  if (read.data === undefined || read.etag === null) {
    return <LoadFailed title={failed} retry={read.retry} />;
  }
  return children(read.data, read.etag);
}
