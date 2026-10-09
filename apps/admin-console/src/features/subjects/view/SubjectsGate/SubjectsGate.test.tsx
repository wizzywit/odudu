import { screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADA_AT, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
});

it('names the capability a principal without view-users lacks', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Subject needs the view-users capability.',
  );
});

it('passes axe in both themes, refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(ADA_AT, subjectRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
