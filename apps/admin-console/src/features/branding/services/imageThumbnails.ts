import type { Read } from '#/shared/services/read';
import {
  DELETE_LABEL,
  imageNote,
  NO_IMAGE,
  REMOVE_LABEL,
  REPLACE_LABEL,
  UPLOAD_LABEL,
} from '#/features/branding/services/copy';
import { imageField, type ImageSlot, type ImageValues } from '#/features/branding/services/values';
import { SLOT_RULES, ACCEPTED_TYPE_LIST } from '#/features/branding/services/imageSlots';

const UPLOADING_NAME = 'Uploading';

const CHUNK = 0x8000;

// Whatever the server says it is, a data address carries it into the page, so
// only the three types an upload can be stored as are shown.
export function imageDataUrl(bytes: Uint8Array, contentType: string | null): string | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ACCEPTED_TYPE_LIST.includes(type)) return null;
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

// Whether a slot holds an image to read, and its id (empty when it holds none).
export interface SlotAsk {
  id: string;
  asked: boolean;
}

// The image each slot holds, which the thumbnails are read for.
export function slotAssetIds(values: ImageValues): Record<ImageSlot, SlotAsk> {
  const askOf = (slot: ImageSlot): SlotAsk => {
    const id = values[imageField(slot)]?.assetId;
    return { id: id ?? '', asked: id !== undefined };
  };
  return {
    logo: askOf('logo'),
    darkLogo: askOf('darkLogo'),
    favicon: askOf('favicon'),
    background: askOf('background'),
  };
}

// What a slot's thumbnail is showing: nothing where the slot holds no image,
// else the state of reading the one it holds.
export type Thumbnail = { status: 'none' } | Read<string>;

export function slotThumbnail(asked: boolean, read: Read<string>): Thumbnail {
  return asked ? read : { status: 'none' };
}

// A logo's thumbnail says what the logo is; an image with no alt text of its
// own says which slot it fills.
export function thumbnailAlt(slot: ImageSlot, alt: string | null): string {
  return alt !== null && alt.trim() !== '' ? alt : SLOT_RULES[slot].label;
}

export const THUMBNAIL_LOADING = 'Loading the image…';

export const THUMBNAIL_FAILED = 'The image could not be shown.';

export const THUMBNAIL_RETRY = 'Try again';

export interface SlotView {
  label: string;
  note: string;
  uploadName: string;
  uploadText: string;
  removeName: string;
  deleteName: string;
  assetId: string | null;
  // The logo's alt text where the slot has one, else null.
  alt: string | null;
}

// What a slot shows of the image it holds.
export function slotView(slot: ImageSlot, values: ImageValues, busy = false): SlotView {
  const { label } = SLOT_RULES[slot];
  const value = values[imageField(slot)];
  const lower = label.toLowerCase();
  const uploadText = value === null ? UPLOAD_LABEL : REPLACE_LABEL;
  return {
    label,
    note: value === null ? NO_IMAGE : imageNote(value.assetId),
    uploadName: busy ? `${UPLOADING_NAME} ${lower}` : `${uploadText} ${lower}`,
    uploadText,
    removeName: `${REMOVE_LABEL}: ${lower}`,
    deleteName: `${DELETE_LABEL}: ${lower}`,
    assetId: value === null ? null : value.assetId,
    alt: value !== null && 'alt' in value ? value.alt : null,
  };
}

// Whether the slot holds exactly this image, which a deletion of it empties.
export function slotNames(values: ImageValues, slot: ImageSlot, assetId: string): boolean {
  return values[imageField(slot)]?.assetId === assetId;
}
