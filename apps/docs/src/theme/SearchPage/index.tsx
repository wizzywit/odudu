import SearchPage from '@theme-original/SearchPage';
import type { ReactElement } from 'react';
import { LandmarkProvider } from '@site/src/shared/use-cases/useLandmark';

// The search plugin's page puts its content straight in the layout with no main landmark.
export default function SearchPageWithLandmark(): ReactElement {
  return (
    <LandmarkProvider value="main">
      <SearchPage />
    </LandmarkProvider>
  );
}
