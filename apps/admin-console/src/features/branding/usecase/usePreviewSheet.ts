import { useEffect, useRef, useState } from 'react';

export interface PreviewSheet {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

// Whether the preview is open as a sheet over the editor. A sheet belongs to
// the strip, so it closes when the strip is put away, as when the screen is
// widened under it.
export function usePreviewSheet(strip: boolean): PreviewSheet {
  const [isOpen, setOpen] = useState(false);
  const wasStrip = useRef(strip);
  useEffect(() => {
    if (wasStrip.current && !strip) setOpen(false);
    wasStrip.current = strip;
  }, [strip]);
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
