import { createContext } from 'react';

// Called as a dialog opens; the function it returns is called as it closes.
// The composition root counts them, so a dialog that would otherwise open
// over another can wait its turn instead.
export type ReportOpenDialog = () => () => void;

export const DialogPresence = createContext<ReportOpenDialog>(() => () => undefined);
