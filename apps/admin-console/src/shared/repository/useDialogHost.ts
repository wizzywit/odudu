import { create } from 'zustand';

interface DialogHost {
  readonly open: number;
  readonly opened: () => () => void;
}

export const useDialogHost = create<DialogHost>()((set) => ({
  open: 0,
  opened: () => {
    set(({ open }) => ({ open: open + 1 }));
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      set(({ open }) => ({ open: open - 1 }));
    };
  },
}));
