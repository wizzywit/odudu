import { useState } from 'react';

export interface PreviewSheet {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

// Whether the preview is open as a sheet over the editor.
export function usePreviewSheet(): PreviewSheet {
  const [isOpen, setOpen] = useState(false);
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
