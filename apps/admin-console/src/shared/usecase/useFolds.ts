import { useState } from 'react';
import { foldToggled } from '#/shared/service/folds';

export interface Folds {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

// Which of a page's folds the person has opened; all start closed.
export function useFolds(): Folds {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (id) => open.has(id),
    toggle: (id) => {
      setOpen((was) => foldToggled(was, id));
    },
  };
}
