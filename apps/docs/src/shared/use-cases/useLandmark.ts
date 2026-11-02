import { createContext, useContext } from 'react';

export type Landmark = 'main' | 'none';

const LandmarkContext = createContext<Landmark>('none');

// A page whose own content has no `<main>` provides 'main' above the theme's layout.
export const LandmarkProvider = LandmarkContext.Provider;

export function useLandmark(): Landmark {
  return useContext(LandmarkContext);
}
