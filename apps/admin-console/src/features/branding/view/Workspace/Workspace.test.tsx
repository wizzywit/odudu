import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Workspace } from '#/features/branding/view/Workspace';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function Frame() {
  return (
    <Workspace
      editor={<section aria-label="Editor">The fields</section>}
      aside={<p>The preview</p>}
    />
  );
}

it('holds the editor and, beside it, a complementary region for the preview', () => {
  render(<Frame />);
  expect(screen.getByRole('region', { name: 'Editor' })).toHaveTextContent('The fields');
  expect(within(screen.getByRole('complementary')).getByText('The preview')).toBeVisible();
});

it('passes axe in both themes', async () => {
  const results = await axeInBothThemes(() => <Frame />);
  expect(results.light).toEqual([]);
  expect(results.dark).toEqual([]);
});
