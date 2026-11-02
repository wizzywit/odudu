import type { Asked } from '#/shared/services/capabilities';

// A choice the confirmation offers beside what it asks, ticked or not by the
// one asking; what it means is the usecase's, and the dialog only draws it.
export interface DialogChoice {
  label: string;
  note: string;
}

// A confirmation a usecase asks for, drawn by DialogAsk: what it leaves out
// the dialog decides, and `typed` is what must be typed before it is confirmed.
export interface DialogAsk extends Asked {
  choice?: DialogChoice;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  typed?: string | null;
}

// An ask that names its own button and tone.
export interface NamedDialog extends DialogAsk {
  confirmLabel: string;
  tone: 'primary' | 'danger';
}
