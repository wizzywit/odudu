import { describe, expect, it } from 'vitest';
import { useLandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { resultOf } from '@site/tests/support/hook';

describe('useLandingPage', () => {
  it('is not in motion on the server, and describes the site from its address', () => {
    const page = resultOf(useLandingPage);
    expect(page.motion).toBe(false);
    expect(page.jsonLd).toContain('https://example.test/odudu/');
    expect(page.jsonLd).not.toContain('<');
  });

  it('carries the page state, then one group of content per section', () => {
    const page = resultOf(useLandingPage);
    expect(Object.keys(page).sort()).toEqual([
      'agents',
      'branding',
      'capabilities',
      'examples',
      'jsonLd',
      'mark',
      'markdown',
      'motion',
      'pageShots',
      'readers',
      'steps',
      'where',
    ]);
    expect(page.mark).toBeUndefined();
  });

  it('hands each section the text it shows', () => {
    const page = resultOf(useLandingPage);
    expect(page.capabilities).toHaveLength(8);
    expect(page.steps).toHaveLength(3);
    expect(page.readers).toHaveLength(4);
    expect(page.examples.cards).toHaveLength(4);
    expect(page.agents.items.map((item) => item.id)).toEqual([
      'mcp-destructive-tools',
      'agent-identity',
    ]);
    expect(page.agents.plannedLabel).toBe('Planned');
    expect(page.branding.id).toBe('branding');
    expect(page.pageShots.large.map((shot) => shot.name)).toEqual(['sign-in', 'create-account']);
    expect(page.pageShots.small).toHaveLength(2);
  });
});
