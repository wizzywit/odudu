import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { pending } from '#/testing/fakeTransport';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { ADA_AT, subjectRoutes } from '#/testing/subjectsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
});

it('names the capability a principal without view-users lacks', async () => {
  renderConsoleAt(ADA_AT, subjectRoutes(['manage-clients']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Subject needs the view-users capability.',
  );
});

it('draws its page, and makes its reads, while whoami is still unanswered', async () => {
  const { sent } = renderConsoleAt('/console/acme/subjects', {
    ...subjectRoutes(),
    [`GET ${ACME_ADMIN}/whoami`]: pending(),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  await waitFor(() => {
    expect(sent.some((s) => s.path.endsWith('/acme/subjects'))).toBe(true);
  });
});

it('passes axe in both themes, refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(ADA_AT, subjectRoutes(['manage-clients'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});
