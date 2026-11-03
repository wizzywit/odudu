import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useState } from 'react';
import { previewSource } from '#/features/branding-editor/repository/preview';
import { usePreviewInfo } from '#/features/branding-editor/repository/usePreviewInfo';
import {
  previewKey,
  previewWith,
  DEFAULT_PREVIEW,
  previewAsked,
  previewRetry,
  pageSummary,
  PREVIEW_WORDS,
  type PreviewChoice,
  type PreviewWords,
} from '#/features/branding-editor/services/preview';
import { noticeLines } from '#/features/branding-editor/services/fallback';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import { chooseKind, type PageKind } from '#/features/branding-editor/services/pageKinds';
import { omissionNote } from '#/features/branding-editor/services/templateParts';
import { chooseScheme, type Scheme } from '#/features/branding-editor/services/colourScheme';

export interface Preview {
  choice: PreviewChoice;
  words: PreviewWords;
  // The strip's line of what the frame shows.
  summary: string;
  // The frame's address, and the key that reloads it when what it shows changed.
  src: string;
  frameKey: string;
  note: string | null;
  // What the frame shows other than the saved draft, and why, as sentences;
  // empty when it is the draft, or until the server has said.
  fallback: string[];
  // The frame has not finished loading what it was asked for.
  loading: boolean;
  // Asks again, once the preview could not be read.
  retry?: (() => void) | undefined;
  onLoaded: () => void;
  setKind: (kind: PageKind) => void;
  // The same choices as a control's id gives them.
  chooseKind: (id: string) => void;
  chooseScheme: (id: string) => void;
}

// What the preview frame shows: one page kind in one scheme, of the saved draft.
export function usePreview(
  tenant: string,
  scope: ThemeScope,
  view: ThemeView | undefined,
  tag: string | null,
  asked: boolean,
): Preview {
  const [choice, setChoice] = useState(DEFAULT_PREVIEW);
  const [loaded, setLoaded] = useState('');
  const frameKey = previewKey(view, tag, choice);
  const info = usePreviewInfo(tenant, scope, choice, frameKey, previewAsked(asked, view));
  const fallback = noticeLines(info, scope);
  const setKind = (kind: PageKind): void => {
    setChoice((was) => previewWith(was, { kind }));
  };
  const setScheme = (scheme: Scheme): void => {
    setChoice((was) => previewWith(was, { scheme }));
  };
  return {
    choice,
    words: PREVIEW_WORDS,
    summary: pageSummary(choice, fallback),
    src: previewSource(tenant, scope, choice),
    frameKey,
    note: omissionNote(choice.kind),
    fallback,
    loading: loaded !== frameKey,
    retry: previewRetry(info),
    onLoaded: () => {
      setLoaded(frameKey);
    },
    setKind,
    chooseKind: (id) => {
      chooseKind(id, setKind);
    },
    chooseScheme: (id) => {
      chooseScheme(id, setScheme);
    },
  };
}
