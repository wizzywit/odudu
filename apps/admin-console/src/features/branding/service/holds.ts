import type { ThemeView } from '@odudu/contracts/admin';
import { andList } from '#/shared/service/format';
import { PUBLISHING } from '#/features/branding/service/copy';
import {
  DISCARD_LABEL,
  REVERT_LABEL,
  REVERTING,
  revertHold,
} from '#/features/branding/service/publication';
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
  // Any other write to the theme: an image, a message override, a version
  // restored, the theme reset, or a section saving.
  saving: boolean;
}

// The short line saying what is running, or undefined when nothing is.
export function runningLine(busy: WritesRunning): string | undefined {
  if (busy.publish) return PUBLISHING;
  if (busy.discard) return DISCARDING;
  if (busy.revert) return REVERTING;
  return busy.saving ? SAVING : undefined;
}

// The hold on the revert of a tab, from the holds of the whole bar.
export function revertHoldOf(holds: PublicationHolds, tab: ScopedTab): string | undefined {
  return tab === 'theme' ? holds.revertTheme : holds.revertPages;
}

// The line under the bar for a Discard that is held for its own reason. With
// no draft the Publish line already says so, and a line the same as Publish's
// is not said twice.
export function discardNote(
  holds: PublicationHolds,
  hasDraft: boolean,
  publishHold: string | undefined,
): string | undefined {
  return hasDraft && holds.discard !== publishHold ? holds.discard : undefined;
}

// What the menu a narrow bar folds its actions under offers: Revert for a tab
// that has parts to take back, and Discard; each held with its reason beside it.
export interface FoldedAction {
  id: 'revert' | 'discard';
  label: string;
  description?: string;
  isDisabled: boolean;
}

export function foldedActions({
  holds,
  tab,
  revertOffered,
  reverting,
}: {
  holds: PublicationHolds;
  tab: ScopedTab;
  revertOffered: boolean;
  reverting: boolean;
}): readonly FoldedAction[] {
  const revertHeld = revertHoldOf(holds, tab);
  const revert: FoldedAction[] = revertOffered
    ? [
        {
          id: 'revert',
          label: reverting ? REVERTING : REVERT_LABEL,
          isDisabled: revertHeld !== undefined,
          ...(revertHeld === undefined ? {} : { description: revertHeld }),
        },
      ]
    : [];
  return [
    ...revert,
    {
      id: 'discard',
      label: DISCARD_LABEL,
      isDisabled: holds.discard !== undefined,
      ...(holds.discard === undefined ? {} : { description: holds.discard }),
    },
  ];
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
