import { useEffect, useRef, useState } from 'react';

export interface PreviewSheet {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

// Whether the preview is open as a sheet over the editor. A sheet belongs to
// the strip, so it closes when the strip is put away, as when the screen is
// widened under it; `landed` then takes focus, since the button that opened
// it is no longer drawn.
export function usePreviewSheet(strip: boolean, landed: () => void): PreviewSheet {
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
    open: () => {
      setOpen(true);
    },
    close: () => {
      setOpen(false);
    },
  };
}
