import type { SlotImage } from '#/features/branding-editor/types/slotImage';
import type { GatewayFailure, GatewayResult } from '#/shared/services/result';
import { failureTextWith } from '#/shared/services/failure';
import { reportFailure } from '#/shared/services/settled';
import { altEdited, logoOf } from '#/features/branding-editor/services/logoAlt';
import {
  uploadRefusal,
  uploadFailureText,
  UPLOAD_FAULT,
  UPLOAD_LOST,
} from '#/features/branding-editor/services/imageRefusals';
import { slotNames } from '#/features/branding-editor/services/imageThumbnails';
import type {
  ImageSlot,
  ImageValues,
  Logo,
  Plain,
} from '#/features/branding-editor/services/imageValues';

// What an uploaded image fills its slot with: a logo keeps the alt text it
// had, and starts without one.
export function imageAfterUpload(
  slot: ImageSlot,
  assetId: string,
  values: ImageValues,
): Logo | Plain {
  if (slot === 'logo') return logoOf(assetId, values['assets.logo']);
  if (slot === 'darkLogo') return logoOf(assetId, values['assets.darkLogo']);
  return { assetId };
}

export interface SlotState {
  busy: boolean;
  error: string | null;
}

export type SlotStates = Readonly<Record<ImageSlot, SlotState>>;

const QUIET: SlotState = { busy: false, error: null };

export const IDLE_SLOTS: SlotStates = {
  logo: QUIET,
  darkLogo: QUIET,
  favicon: QUIET,
  background: QUIET,
};

export function slotBusy(slots: SlotStates, slot: ImageSlot): SlotStates {
  return { ...slots, [slot]: { busy: true, error: null } };
}

export function slotFailed(slots: SlotStates, slot: ImageSlot, error: string): SlotStates {
  return { ...slots, [slot]: { busy: false, error } };
}

export function slotDone(slots: SlotStates, slot: ImageSlot): SlotStates {
  return { ...slots, [slot]: QUIET };
}

// What any failed upload says; `uploadFailureText` is the part for a refusal
// the server answered, which this one hands it.
export function uploadFailureOf(slot: ImageSlot, failure: GatewayFailure): string {
  return failureTextWith({
    network: () => UPLOAD_LOST,
    schema: () => UPLOAD_FAULT,
    defect: () => UPLOAD_FAULT,
    problem: (problem) => uploadFailureText(slot, problem),
  })(failure);
}

export interface UploadStart {
  // Takes the change to the slots as a function of the slots at the time it runs.
  show: (next: (was: SlotStates) => SlotStates) => void;
  send: () => void;
}

// Marks the slot busy and sends the file, or fails the slot in place when the
// file is refused here, before anything is sent.
export function startUpload(
  slot: ImageSlot,
  file: { type: string; size: number },
  to: UploadStart,
): void {
  const refused = uploadRefusal(slot, file);
  to.show((was) => (refused === null ? slotBusy(was, slot) : slotFailed(was, slot, refused)));
  if (refused === null) to.send();
}

// The slot once its upload has answered.
export function slotAfterUpload(
  slots: SlotStates,
  slot: ImageSlot,
  result: GatewayResult<SlotImage>,
): SlotStates {
  return result.ok ? slotDone(slots, slot) : slotFailed(slots, slot, uploadFailureOf(slot, result));
}

// What an answered upload puts in its slot, nothing when it was refused.
export function uploadedImage(
  slot: ImageSlot,
  result: GatewayResult<SlotImage>,
  values: ImageValues,
): Logo | Plain | null {
  return result.ok ? imageAfterUpload(slot, result.data.id, values) : null;
}

export interface UploadAnswer {
  show: (next: (was: SlotStates) => SlotStates) => void;
  edit: (slot: ImageSlot, image: Logo | Plain | null) => void;
  report: (failure: GatewayFailure) => void;
}

// Settles the slot, fills it when the file landed and reports a refusal.
export function finishUpload(
  slot: ImageSlot,
  result: GatewayResult<SlotImage>,
  values: ImageValues,
  to: UploadAnswer,
): void {
  to.show((was) => slotAfterUpload(was, slot, result));
  const image = uploadedImage(slot, result, values);
  if (image !== null) to.edit(slot, image);
  reportFailure(result, to.report);
}

// Sets a logo's alt text where a logo is set.
export function editAlt(
  values: ImageValues,
  slot: ImageSlot,
  alt: string,
  edit: (slot: ImageSlot, logo: Logo) => void,
): void {
  if (slot !== 'logo' && slot !== 'darkLogo') return;
  const logo = altEdited(values, slot, alt);
  if (logo !== null) edit(slot, logo);
}

// Empties the slot that still names a deleted image.
export function forgetImage(
  values: ImageValues,
  slot: ImageSlot,
  assetId: string,
  edit: (slot: ImageSlot, image: null) => void,
): void {
  if (slotNames(values, slot, assetId)) edit(slot, null);
}
