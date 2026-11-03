import type { ThemeView } from '#/features/branding-editor/types/theme';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PUBLISHING } from '#/features/branding-editor/services/publishDraft';
import { NO_OUTCOME } from '#/features/branding-editor/services/publishOutcome';
import { NO_DRAFT_TO_DISCARD } from '#/features/branding-editor/services/discardDraft';
import { TENANT_SCOPE } from '#/features/branding-editor/services/themeScope';
import { usePublicationBar } from '#/features/branding-editor/use-cases/usePublicationBar';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
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

function discardHold(current: ReturnType<typeof usePublicationBar>): string | undefined {
  return current.bar.menu.actions.find((action) => action.id === 'discard')?.description;
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
  expect(result.current.publication.hold).toBeUndefined();
  expect(result.current.bar.discard.disabled).toBe(false);
  expect(result.current.revert.hold).toBeUndefined();
  expect(bar(DRAFTED, 'pages').result.current.revert.hold).toBe(
    'This tab already matches what is published.',
  );
});

it('refuses to publish while a section has unsaved edits, and names it', () => {
  const { result } = bar(DRAFTED);
  unsaved(['colours', 'Colours and font']);
  expect(result.current.publication.hold).toBe(
    'Save your changes first, in “Colours and font”: publishing uses the saved draft.',
  );
  expect(discardHold(result.current)).toBe(
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
  expect(discardHold(result.current)).toBe(NO_DRAFT_TO_DISCARD);
});

it('offers a revert on the tabs that have parts to take back, taking the Theme’s for any other', () => {
  const offered = (tab: string) =>
    bar(DRAFTED, tab).result.current.bar.menu.actions.map((action) => action.id);
  expect(offered('theme')).toEqual(['revert', 'discard']);
  expect(offered('pages')).toEqual(['revert', 'discard']);
  expect(offered('mail')).toEqual(['discard']);
  expect(bar(DRAFTED, 'theme').result.current.revert.section).toBe(
    bar(DRAFTED, 'mail').result.current.revert.section,
  );
  expect(bar(DRAFTED, 'pages').result.current.revert.section).not.toBe(
    bar(DRAFTED, 'theme').result.current.revert.section,
  );
});

it('holds every action while the draft is being published', async () => {
  const { result } = bar(DRAFTED, 'theme', { [`POST ${TH}/publish`]: pending() });
  act(() => {
    result.current.publication.publish();
  });
  await waitFor(() => {
    expect(result.current.publication.busy).toBe(true);
  });
  expect(result.current.publication.hold).toBe(PUBLISHING);
  expect(discardHold(result.current)).toBe(PUBLISHING);
  expect(result.current.revert.hold).toBe(PUBLISHING);
});

it('folds Revert and Discard under the menu, each held with its reason', () => {
  const { result } = bar(DRAFTED, 'pages');
  const folded = result.current.bar.menu.actions.map((action) => ({
    id: action.id,
    label: action.label,
    isDisabled: action.isDisabled,
    description: action.description,
  }));
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
