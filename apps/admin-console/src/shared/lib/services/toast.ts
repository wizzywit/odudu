export type ToastTone = 'success' | 'error';

// A toast is never the only copy of anything a person must act on, and never
// carries a secret: it is announced, and a success one disappears.
export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}
