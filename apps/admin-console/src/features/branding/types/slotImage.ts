export type SlotKind = 'logo' | 'darkLogo' | 'favicon' | 'background';

// An image uploaded to fill a slot of the theme.
export interface SlotImage {
  id: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  kind: SlotKind;
}
