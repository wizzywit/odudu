import type { ReactElement } from 'react';
import { NOT_FOUND_CONTENT, NotFoundPage } from '@site/src/features/not-found';

// The content of the theme's not-found route. The theme keeps the route's
// page metadata and layout around it.
export default function NotFoundContent(): ReactElement {
  return <NotFoundPage content={NOT_FOUND_CONTENT} />;
}
