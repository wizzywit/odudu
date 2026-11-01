import type { ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { previewSource } from '#/features/branding/repository/preview';
import { usePreviewInfo } from '#/features/branding/repository/usePreviewInfo';
import {
  DEFAULT_PREVIEW,
  noticeLines,
  omissionNote,
  previewAsked,
  previewKey,
  previewRetry,
  previewWith,
  type PageKind,
  type PreviewChoice,
  type Scheme,
  type ThemeScope,
} from '#/features/branding/service';

export interface Preview {
  choice: PreviewChoice;
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
  setScheme: (scheme: Scheme) => void;
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
  return {
    choice,
    src: previewSource(tenant, scope, choice),
    frameKey,
    note: omissionNote(choice.kind),
    fallback: noticeLines(info, scope),
    loading: loaded !== frameKey,
    retry: previewRetry(info),
    onLoaded: () => {
      setLoaded(frameKey);
    },
    setKind: (kind) => {
      setChoice((was) => previewWith(was, { kind }));
    },
    setScheme: (scheme) => {
      setChoice((was) => previewWith(was, { scheme }));
    },
  };
}
