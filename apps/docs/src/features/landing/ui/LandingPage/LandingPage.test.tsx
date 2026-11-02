import { describe, expect, it } from 'vitest';
import { LandingPage } from '@site/src/features/landing/ui/LandingPage/LandingPage';
import { markupOf } from '@site/tests/support/markup';

describe('LandingPage', () => {
  it('is the page marked as the landing, with a hero and ten more bands', () => {
    const $ = markupOf(<LandingPage />);
    expect($('main[data-page="landing"]')).toHaveLength(1);
    expect($('main > header')).toHaveLength(1);
    expect($('main > section')).toHaveLength(10);
    expect($('h1')).toHaveLength(1);
  });

  it('preloads the three fonts of the first screen and describes the software for search', () => {
    const $ = markupOf(<LandingPage />);
    expect($('link[rel="preload"][as="font"]')).toHaveLength(3);
    const graph = JSON.parse($('script[type="application/ld+json"]').text()) as {
      '@graph': { '@type': string }[];
    };
    expect(graph['@graph'].map((node) => node['@type'])).toEqual([
      'SoftwareApplication',
      'Organization',
    ]);
  });

  it('is not marked for motion on the server', () => {
    const $ = markupOf(<LandingPage />);
    expect($('main').attr('data-motion')).toBeUndefined();
  });
});
