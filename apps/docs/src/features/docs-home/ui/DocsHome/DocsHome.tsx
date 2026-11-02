import type { ReactElement } from 'react';
import { introOf, type Audience } from '@site/src/features/docs-home/services/intro';
import { HomeMap } from '@site/src/features/docs-home/ui/HomeMap/HomeMap';

interface Props {
  audience: Audience;
}

// The way through the documentation: the whole of the image's home, and the
// public site's `docs/` page beside its landing.
export function DocsHome({ audience }: Props): ReactElement {
  return (
    <main className="container margin-vert--lg" data-page="docs-home">
      <h1>Documentation</h1>
      <p>{introOf(audience)}</p>
      <HomeMap />
    </main>
  );
}
