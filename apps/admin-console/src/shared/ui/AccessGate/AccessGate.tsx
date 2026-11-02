import type { ReactNode } from 'react';
import type { Crumb } from '#/shared/ui/Breadcrumb';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { PageHeader } from '#/shared/ui/PageHeader';
import { PageNotFound } from '#/shared/ui/PageNotFound';
import { Skeleton } from '#/shared/ui/Skeleton';

// What whoami says of a principal's reach into an area.
export type Access =
  { kind: 'hidden' | 'checking' | 'open' } | { kind: 'refused'; capability: string };

// whoami is advice: a principal it says cannot read the area is told what
// that needs, rather than offered reads the server would refuse, and an area
// it does not name is simply not a page.
export function AccessGate({
  access,
  title,
  kicker,
  breadcrumb,
  checking,
  children,
}: {
  access: Access;
  title: string;
  kicker: string;
  // A page below the list keeps its way back while it is refused.
  breadcrumb?: readonly Crumb[];
  // What the placeholder says until whoami has answered; null draws the page
  // meanwhile.
  checking: string | null;
  children: ReactNode;
}) {
  const head = (
    <PageHeader {...(breadcrumb === undefined ? { kicker } : { breadcrumb })} title={title} />
  );
  switch (access.kind) {
    case 'hidden':
      return <PageNotFound />;
    case 'refused':
      return (
        <>
          {head}
          <CapabilityNote capability={access.capability}>{title}</CapabilityNote>
        </>
      );
    case 'checking':
      if (checking === null) return children;
      return (
        <>
          {head}
          <Skeleton label={checking} />
        </>
      );
    case 'open':
      return children;
  }
}
