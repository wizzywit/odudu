import { expect, it } from 'vitest';
import recordSheet from '#/shared/ui/RecordTab/RecordTab.module.css?raw';

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '');

it('keeps an empty message in the accessibility tree and out of the layout', () => {
  const rule = /\.message:empty\s*\{([^}]*)\}/u.exec(withoutComments(recordSheet));
  expect(rule?.[1]).toContain('position: absolute');
  expect(rule?.[1]).not.toContain('display');
});
