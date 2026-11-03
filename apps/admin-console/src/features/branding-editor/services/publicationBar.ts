import type { ThemeView } from '#/features/branding-editor/types/theme';
import {
  barText,
  changeBrief,
  MORE_LABEL,
  MORE_TRIGGER,
  publishedShort,
} from '#/features/branding-editor/services/changeSummary';
import {
  DISCARD_CONFIRM,
  DISCARD_LABEL,
  DISCARD_TITLE,
  discardBody,
} from '#/features/branding-editor/services/discardDraft';
import {
  discardNote,
  foldedActions,
  type FoldedAction,
  type PublicationHolds,
} from '#/features/branding-editor/services/publicationHolds';
import {
  PUBLISH_BODY,
  PUBLISH_LABEL,
  PUBLISH_SHORT,
  PUBLISH_TITLE,
  PUBLISHING,
  publishedTag,
  publishedText,
} from '#/features/branding-editor/services/publishDraft';
import {
  ISSUES_LABEL,
  WARNINGS_NOTE,
  WARNINGS_TITLE,
} from '#/features/branding-editor/services/publishIssues';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import type { ScopedTab } from '#/features/branding-editor/services/tabs';

export interface PublicationStatus {
  title: string;
  tag: { text: string; tone: 'active' | 'neutral' };
  short: string;
  published: string;
  sentence: string;
  brief: string;
  explain: string;
}

// What the bar says of the theme: whether it is live, and what is waiting.
export function publicationStatus(view: ThemeView): PublicationStatus {
  return {
    title: PUBLISH_TITLE,
    tag: publishedTag(view),
    short: publishedShort(view),
    published: publishedText(view),
    sentence: barText(view),
    brief: changeBrief(view),
    explain: PUBLISH_BODY,
  };
}

// The words on Publish, in the bar's wide and narrow forms.
export function publishButton(busy: boolean): { label: string; short: string } {
  return {
    label: busy ? PUBLISHING : PUBLISH_LABEL,
    short: busy ? PUBLISHING : PUBLISH_SHORT,
  };
}

export interface OutcomeView {
  message: string | null;
  problem: string | null;
  issues: { label: string; lines: readonly string[]; more: string | null } | null;
  warnings: { title: string; note: string; lines: readonly string[] } | null;
}

// What the last publish or revert said, in the order the bar shows it.
export function outcomeView(outcome: PublishOutcome, revertProblem: string | null): OutcomeView {
  return {
    message: outcome.message,
    problem: revertProblem,
    issues:
      outcome.issues.lines.length === 0
        ? null
        : { label: ISSUES_LABEL, lines: outcome.issues.lines, more: outcome.issues.more },
    warnings:
      outcome.warnings.length === 0
        ? null
        : { title: WARNINGS_TITLE, note: WARNINGS_NOTE, lines: outcome.warnings },
  };
}

export interface DiscardView {
  label: string;
  disabled: boolean;
  dialog: { title: string; consequence: string; confirmLabel: string };
}

export function discardView(scope: ThemeScope, holds: PublicationHolds): DiscardView {
  return {
    label: DISCARD_LABEL,
    disabled: holds.discard !== undefined,
    dialog: {
      title: DISCARD_TITLE,
      consequence: discardBody(scope),
      confirmLabel: DISCARD_CONFIRM,
    },
  };
}

export interface BarMenu {
  label: string;
  trigger: string;
  actions: (FoldedAction & { onAction: () => void })[];
}

// The menu a narrow bar folds Revert and Discard into, each held or not.
export function barMenu(
  input: {
    holds: PublicationHolds;
    tab: ScopedTab;
    revertOffered: boolean;
    reverting: boolean;
  },
  handlers: Record<FoldedAction['id'], () => void>,
): BarMenu {
  return {
    label: MORE_LABEL,
    trigger: MORE_TRIGGER,
    actions: foldedActions(input).map((action) => ({ ...action, onAction: handlers[action.id] })),
  };
}

// The warnings the bar shows beside Publish: what holds it, and what holds
// Discard where that is another reason.
export function holdNotes(
  holds: PublicationHolds,
  view: ThemeView,
  publishHold: string | undefined,
): { publish: string | undefined; discard: string | undefined } {
  return { publish: publishHold, discard: discardNote(holds, view.draft !== null, publishHold) };
}
