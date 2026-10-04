export type RecordStatus = 'loading' | 'ready' | 'missing' | 'failed';

// What a record page shows about the read behind it, whatever the record is.
export interface RecordView {
  status: RecordStatus;
  // Somebody else changed the record since this page read it; a save made
  // here moves the record on without saying so.
  updated: boolean;
  // A read after the first failed, so what is shown may be out of date;
  // the record and every edit on it stay on screen.
  refreshFailed: boolean;
  // That read found the record deleted.
  gone: boolean;
  acknowledge: () => void;
  retry: () => void;
}
