import { useEffect, useRef, useState } from 'react';
import { shellWords, type ShellWords } from '#/features/branding-editor/services/preview';

export interface PreviewShell {
  isOpen: boolean;
  words: ShellWords;
  open: () => void;
  close: () => void;
}

// Whether the preview is open as a sheet over the editor, and the words the
// shell and its frame say. A sheet belongs to the strip, so it closes when
// the strip is put away, as when the screen is widened under it; `landed`
// then takes focus, since the button that opened it is no longer drawn.
export function usePreviewShell(
  strip: boolean,
  landed: () => void,
  frameTitle: string,
): PreviewShell {
  const [isOpen, setOpen] = useState(false);
  const wasStrip = useRef(strip);
  const widened = useRef(false);
  useEffect(() => {
    if (wasStrip.current && !strip) {
      widened.current = isOpen;
      setOpen(false);
    }
    wasStrip.current = strip;
  }, [strip, isOpen]);
  useEffect(() => {
    if (isOpen || !widened.current) return;
    widened.current = false;
    landed();
  }, [isOpen, landed]);
  return {
    isOpen,
    words: shellWords(frameTitle),
    open: () => {
      setOpen(true);
    },
    close: () => {
      setOpen(false);
    },
  };
}
