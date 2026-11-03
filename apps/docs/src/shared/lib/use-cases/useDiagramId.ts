import { useId } from 'react';

// An id for one drawing's title, description and arrowhead, unique on the page.
export function useDiagramId(): string {
  return useId().replaceAll(':', '');
}
