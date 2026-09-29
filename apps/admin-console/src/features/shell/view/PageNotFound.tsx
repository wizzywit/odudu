import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';

export function PageNotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState variant="nothing-matches" title="No page has this address">
        Check the address, or choose an area from the menu.
      </EmptyState>
    </>
  );
}
