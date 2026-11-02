import { EmptyState } from '#/shared/ui/EmptyState';
import { LostArt } from '#/shared/ui/LostArt';
import { PageHeader } from '#/shared/ui/PageHeader';

export function PageNotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <LostArt />
      <EmptyState variant="nothing-matches" title="No page has this address">
        Check the address, or choose an area from the menu.
      </EmptyState>
    </>
  );
}
