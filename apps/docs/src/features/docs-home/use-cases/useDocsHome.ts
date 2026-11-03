import {
  homeMapSections,
  type HomeMapSections,
} from '@site/src/features/docs-home/services/homeMap';
import { introOf, type Audience } from '@site/src/features/docs-home/services/intro';

export interface DocsHomeModel {
  intro: string;
  sections: HomeMapSections;
}

export function useDocsHome(audience: Audience): DocsHomeModel {
  return { intro: introOf(audience), sections: homeMapSections() };
}
