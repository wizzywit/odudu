import type { ThemeView } from '#/features/branding-editor/types/theme';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PUBLISHING } from '#/features/branding-editor/services/publishDraft';
import { NO_OUTCOME } from '#/features/branding-editor/services/publishOutcome';
import { foldedActions } from '#/features/branding-editor/services/publicationHolds';
import { NO_DRAFT_TO_DISCARD } from '#/features/branding-editor/services/discardDraft';
import { TENANT_SCOPE } from '#/features/branding-editor/services/themeScope';
import { usePublicationBar } from '#/features/branding-editor/use-cases/usePublicationBar';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { draftedView, TH, themeView } from '#/testing/brandingFixtures';
import { pending } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

function bar(view: ThemeView, tab = 'theme', routes = {}) {
  const { wrapper } = hookHarness(routes);
  return renderHook(
    () =>
      usePublicationBar({
        tenant: 'acme',
        scope: TENANT_SCOPE,
        view,
        tag: '"d1"',
        tab,
        published: NO_OUTCOME,
        onPublished: () => undefined,
      }),
    { wrapper },
  );
}

const DRAFTED = draftedView() as ThemeView;

function unsaved(...sections: [string, string][]) {
  act(() => {
    for (const [id, label] of sections)
      useUnsavedGuard.getState().setDirty(`acme/theme#${id}`, label);
  });
}

it('holds nothing for a saved draft with something to publish', () => {
  const { result } = bar(DRAFTED);
  expect(result.current.holds).toEqual({
    publish: undefined,
    discard: undefined,
    revertTheme: undefined,
    revertPages: 'This tab already matches what is published.',
  });
  expect(result.current.publication.hold).toBeUndefined();
});

it('refuses to publish while a section has unsaved edits, and names it', () => {
  const { result } = bar(DRAFTED);
  unsaved(['colours', 'Colours and font']);
  expect(result.current.publication.hold).toBe(
    'Save your changes first, in “Colours and font”: publishing uses the saved draft.',
  );
  expect(result.current.holds.discard).toBe(
    'Save or discard your changes first, in “Colours and font”: discarding the draft does not touch them.',
  );
  expect(result.current.revert.hold).toBe(
    'Save your changes first, in “Colours and font”: reverting works on the saved draft.',
  );
});

it('names every section holding unsaved edits, in the order they sit', () => {
  const { result } = bar(DRAFTED);
  unsaved(['templates', 'Page templates'], ['images', 'Images']);
  expect(result.current.publication.hold).toBe(
    'Save your changes first, in “Images” and “Page templates”: publishing uses the saved draft.',
  );
});

it('says there is no draft to publish or discard when there is none', () => {
  const { result } = bar(themeView() as ThemeView);
  expect(result.current.publication.hold).toMatch(/no draft to publish/u);
  expect(result.current.holds.discard).toBe(NO_DRAFT_TO_DISCARD);
});

it('offers a revert on the tabs that have parts to take back, taking the Theme’s for any other', () => {
  expect(bar(DRAFTED, 'theme').result.current).toMatchObject({
    revertOffered: true,
    revertTab: 'theme',
  });
  expect(bar(DRAFTED, 'pages').result.current).toMatchObject({
    revertOffered: true,
    revertTab: 'pages',
  });
  expect(bar(DRAFTED, 'mail').result.current).toMatchObject({
    revertOffered: false,
    revertTab: 'theme',
  });
});

it('holds every action while the draft is being published', async () => {
  const { result } = bar(DRAFTED, 'theme', { [`POST ${TH}/publish`]: pending() });
  act(() => {
    result.current.publication.publish();
  });
  await waitFor(() => {
    expect(result.current.publication.busy).toBe(true);
  });
  expect(result.current.holds).toEqual({
    publish: PUBLISHING,
    discard: PUBLISHING,
    revertTheme: PUBLISHING,
    revertPages: PUBLISHING,
  });
});

it('folds Revert and Discard under the menu, each held with its reason', () => {
  const { result } = bar(DRAFTED, 'pages');
  const folded = foldedActions({
    holds: result.current.holds,
    tab: result.current.revertTab,
    revertOffered: result.current.revertOffered,
    reverting: result.current.revert.busy,
  });
  expect(folded).toEqual([
    {
      id: 'revert',
      label: 'Revert this tab to published',
      isDisabled: true,
      description: 'This tab already matches what is published.',
    },
    { id: 'discard', label: 'Discard draft…', isDisabled: false },
  ]);
});
