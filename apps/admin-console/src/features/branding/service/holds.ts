import type { ThemeView } from '@odudu/contracts/admin';
import { andList } from '#/shared/service/format';
import { PUBLISHING } from '#/features/branding/service/copy';
import { REVERTING, revertHold } from '#/features/branding/service/publication';
import { publishHold } from '#/features/branding/service/publish';
import type { ScopedTab } from '#/features/branding/service/tabs';

export const DISCARDING = 'Discarding…';

export const SAVING = 'Saving…';

export const NO_DRAFT_TO_DISCARD = 'There is no draft to discard.';

export function discardUnsaved(sections: readonly string[]): string {
  return `Save or discard your changes first, in ${andList(sections.map((title) => `“${title}”`))}: discarding the draft does not touch them.`;
}

// Which writes to the theme are running now, whichever part of the page asked.
export interface WritesRunning {
  publish: boolean;
  discard: boolean;
  revert: boolean;
  // Any other write: a version restored, the theme reset, a section saved.
  sectionSave: boolean;
}

// The short line saying what is running, or undefined when nothing is.
export function runningLine(busy: WritesRunning): string | undefined {
  if (busy.publish) return PUBLISHING;
  if (busy.discard) return DISCARDING;
  if (busy.revert) return REVERTING;
  return busy.sectionSave ? SAVING : undefined;
}

// The hold on the revert of a tab, from the holds of the whole bar.
export function revertHoldOf(holds: PublicationHolds, tab: ScopedTab): string | undefined {
  return tab === 'theme' ? holds.revertTheme : holds.revertPages;
}

// Why each thing the publication bar does is held, or undefined where it is
// not. While any write runs every action is held, so no two overlap on one
// tag; otherwise each is held by what is wrong with its own.
export interface PublicationHolds {
  publish: string | undefined;
  discard: string | undefined;
  revertTheme: string | undefined;
  revertPages: string | undefined;
}

export function publicationHolds({
  view,
  busy,
  unsaved,
  unsavedByTab,
  contrast,
}: {
  view: ThemeView;
  busy: WritesRunning;
  // Every section of the theme holding unsaved edits.
  unsaved: readonly string[];
  // The ones of each tab a revert is about.
  unsavedByTab: Readonly<Record<ScopedTab, readonly string[]>>;
  contrast: string | undefined;
}): PublicationHolds {
  const running = runningLine(busy);
  if (running !== undefined) {
    return { publish: running, discard: running, revertTheme: running, revertPages: running };
  }
  const discard =
    view.draft === null
      ? NO_DRAFT_TO_DISCARD
      : unsaved.length > 0
        ? discardUnsaved(unsaved)
        : undefined;
  return {
    publish: publishHold({ view, unsaved, contrast }),
    discard,
    revertTheme: revertHold({ view, tab: 'theme', unsaved: unsavedByTab.theme }),
    revertPages: revertHold({ view, tab: 'pages', unsaved: unsavedByTab.pages }),
  };
}
