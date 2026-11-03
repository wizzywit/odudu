import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { Read } from '#/shared/services/read';
import { FALLBACK_TITLE } from '#/features/branding-editor/services/fallback';
import {
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  type PageKind,
} from '#/features/branding-editor/services/pageKinds';
import {
  SCHEME_LABELS,
  SCHEME_PICKER_LABEL,
  schemeOptions,
  type Scheme,
} from '#/features/branding-editor/services/colourScheme';

export interface PreviewChoice {
  kind: PageKind;
  scheme: Scheme;
}

export const DEFAULT_PREVIEW: PreviewChoice = { kind: 'sign-in', scheme: 'light' };

export const PREVIEW_TITLE = 'Preview';

export const PREVIEW_KIND_LABEL = 'Page';

export const PREVIEW_NOTE =
  'The saved draft, drawn by the real page. Unsaved changes appear after you save them.';

export const PREVIEW_FRAME_TITLE = 'Preview of the page';

export const PREVIEW_LOADING = 'Loading the preview';

export const PREVIEW_FAILED = 'The preview could not be shown.';

// On a narrow screen the preview is a strip beside the editor; this opens it
// to a page of its own.
export const PREVIEW_OPEN_LABEL = 'Open preview';

export const PREVIEW_SHEET_TITLE = 'Page preview';

export const PREVIEW_CLOSE_LABEL = 'Close preview';

// Said in the strip when the preview shows something other than the saved draft.
export const PREVIEW_DIFFERS = 'not the saved draft';

// The sheet's frame is the same page drawn large, so it is named apart from
// the strip's, and is not announced as a second preview of the same thing.
export function sheetFrameTitle(title: string): string {
  return `${title}, full size`;
}

// The strip's line of what it shows: the page, its scheme, and what else the
// preview was asked for.
export function previewSummary(...parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ');
}

// Whether the preview's account is wanted: a preview is framed and there is a
// theme to frame it over.
export function previewAsked(framed: boolean, view: unknown): boolean {
  return framed && view !== undefined;
}

// How to ask for the preview again, when what it shows could not be read.
export function previewRetry(read: Read<unknown>): (() => void) | undefined {
  return read.status === 'failed' ? read.retry : undefined;
}

export function previewWith(choice: PreviewChoice, change: Partial<PreviewChoice>): PreviewChoice {
  return { ...choice, ...change };
}

// A frame reloads when what it shows may have changed: the published version,
// the draft, or what is asked of it.
export function previewKey(
  view: ThemeView | undefined,
  tag: string | null,
  choice: PreviewChoice,
): string {
  return `${String(view?.published?.version ?? 0)}|${tag ?? ''}|${choice.kind}|${choice.scheme}`;
}

export interface FrameWords {
  failed: string;
  loading: string;
}

export interface ShellWords {
  open: string;
  sheetTitle: string;
  close: string;
  sheetFrameTitle: string;
  frame: FrameWords;
}

// What the shell and its frame say besides the page's own words: the button
// to the sheet, the sheet, and the frame's states.
export function shellWords(frameTitle: string): ShellWords {
  return {
    open: PREVIEW_OPEN_LABEL,
    sheetTitle: PREVIEW_SHEET_TITLE,
    close: PREVIEW_CLOSE_LABEL,
    sheetFrameTitle: sheetFrameTitle(frameTitle),
    frame: { failed: PREVIEW_FAILED, loading: PREVIEW_LOADING },
  };
}

export interface PreviewWords {
  title: string;
  lead: string;
  kindLabel: string;
  kindOptions: typeof PAGE_KIND_OPTIONS;
  schemeLabel: string;
  schemeOptions: typeof schemeOptions;
  fallbackTitle: string;
  frameTitle: string;
}

export const PREVIEW_WORDS: PreviewWords = {
  title: PREVIEW_TITLE,
  lead: PREVIEW_NOTE,
  kindLabel: PREVIEW_KIND_LABEL,
  kindOptions: PAGE_KIND_OPTIONS,
  schemeLabel: SCHEME_PICKER_LABEL,
  schemeOptions,
  fallbackTitle: FALLBACK_TITLE,
  frameTitle: PREVIEW_FRAME_TITLE,
};

// The strip's line for the page of the theme: its kind, its scheme, and that
// it is not the saved draft when the server said it shows something else.
export function pageSummary(choice: PreviewChoice, fallback: readonly string[]): string {
  return previewSummary(
    PAGE_KIND_LABELS[choice.kind],
    SCHEME_LABELS[choice.scheme],
    fallback.length === 0 ? '' : PREVIEW_DIFFERS,
  );
}
