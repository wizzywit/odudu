import { describe, expect, it } from 'vitest';
import { CHIPS } from '@site/src/features/landing/services/sceneShapes';
import { Scene } from '@site/src/features/landing/ui/Scene/Scene';
import { markupOf } from '@site/tests/support/markup';

describe('Scene', () => {
  it('describes the whole picture in words', () => {
    const $ = markupOf(<Scene layout="wide" step={0} uid="t" />);
    expect($('svg').attr('role')).toBe('img');
    expect($('svg').attr('data-layout')).toBe('wide');
    expect($('title').text()).toBe('How a person signs in through Odudu');
    expect($('desc').text().length).toBeGreaterThan(100);
  });

  it('draws the browser, two apps and Odudu with the three ways to sign in', () => {
    const $ = markupOf(<Scene layout="tall" step={0} uid="t" />);
    const labels = $('text')
      .map((_, text) => $(text).text())
      .get();
    expect(labels).toEqual(
      expect.arrayContaining([
        'Their browser',
        'App A',
        'App B',
        'Odudu',
        ...CHIPS.map((chip) => chip.label),
      ]),
    );
    expect($('[data-claim-chip]')).toHaveLength(3);
  });

  it('plays nothing at rest and lights the routes of the current step', () => {
    const rest = markupOf(<Scene layout="wide" step={0} uid="t" />);
    expect(rest('[data-on="true"]')).toHaveLength(3);
    expect(rest('circle[style*="animation-name"]')).toHaveLength(0);
    const second = markupOf(<Scene layout="wide" step={2} uid="t" />);
    expect(second('circle[style*="animation-name"]')).toHaveLength(3);
  });

  it('sends the signed pass along the route to the app in the fourth step', () => {
    const $ = markupOf(<Scene layout="wide" step={4} uid="t" />);
    expect($('g[style*="pass-wide-ha"]')).toHaveLength(1);
  });
});
