import { MAX_ALT_LENGTH } from '@odudu/contracts';
import type { FieldError } from '@odudu/contracts/admin';
import type { Read } from '#/shared/service/read';
import type { Problem } from '#/shared/service/result';
import { problemSubtype } from '#/shared/service/failure';
import { bytesText, counted } from '#/shared/service/format';
import {
  DELETE_LABEL,
  imageNote,
  NO_IMAGE,
  REMOVE_LABEL,
  REPLACE_LABEL,
  UPLOAD_LABEL,
} from '#/features/branding/service/copy';
import {
  imageField,
  type ImageSlot,
  type ImageValues,
  type Logo,
} from '#/features/branding/service/values';

const KIB = 1024;

export interface SlotRule {
  label: string;
  hint: string;
  bytes: number;
  side: number;
}

const SMALL = { bytes: 256 * KIB, side: 1024 } as const;

// The limits the server holds each kind to, stated beside its upload. The
// server decides; stating them first saves a trip for the usual mistake.
export const SLOT_RULES: Readonly<Record<ImageSlot, SlotRule>> = {
  logo: { label: 'Logo', hint: 'Shown above the form.', ...SMALL },
  darkLogo: {
    label: 'Logo for the dark scheme',
    hint: 'Used instead of the logo when the page is dark, so a dark logo does not vanish.',
    ...SMALL,
  },
  favicon: { label: 'Favicon', hint: 'The icon in the browser tab.', ...SMALL },
  background: {
    label: 'Background image',
    hint: 'Behind the page.',
    bytes: 1024 * KIB,
    side: 2560,
  },
};

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp';

export const TENANT_IMAGE_CAP = '8 MiB';

export function limitText(slot: ImageSlot): string {
  const rule = SLOT_RULES[slot];
  return `PNG, JPEG or WebP, up to ${bytesText(rule.bytes)} and ${String(rule.side)} pixels on the longer side. All the tenant’s images together may total ${TENANT_IMAGE_CAP}.`;
}

export const ALT_LABEL = 'Alt text';

export const ALT_RULE = `Required: what the logo shows, for people who cannot see it. Up to ${String(MAX_ALT_LENGTH)} characters.`;

export function altProblem(alt: string): string | undefined {
  if (alt.trim() === '') return 'Describe the logo; it is required.';
  return alt.length > MAX_ALT_LENGTH
    ? `Keep it to ${String(MAX_ALT_LENGTH)} characters or fewer.`
    : undefined;
}

// The logo of a slot with its alt text changed, or null where there is none.
export function altEdited(
  values: ImageValues,
  slot: 'logo' | 'darkLogo',
  alt: string,
): Logo | null {
  const logo = slot === 'logo' ? values['assets.logo'] : values['assets.darkLogo'];
  return logo === null ? null : { assetId: logo.assetId, alt };
}

export function logoOf(assetId: string, previous: Logo | null): Logo {
  return { assetId, alt: previous?.alt ?? '' };
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// A file the server would refuse by its size or type, said before it is sent.
// The bytes and the decoded size are the server's to judge.
export function uploadRefusal(
  slot: ImageSlot,
  file: { type: string; size: number },
): string | null {
  const rule = SLOT_RULES[slot];
  if (file.type !== '' && !TYPES.includes(file.type)) {
    return 'That is not a PNG, a JPEG or a WebP.';
  }
  return file.size > rule.bytes
    ? `That image is over ${bytesText(rule.bytes)}, the most a ${rule.label.toLowerCase()} may be.`
    : null;
}

function tooLarge(slot: ImageSlot): string {
  return `The image is over ${bytesText(SLOT_RULES[slot].bytes)} for a ${SLOT_RULES[slot].label.toLowerCase()}, as uploaded or once stored.`;
}

const ASSET_PROBLEMS: Readonly<Record<string, (slot: ImageSlot) => string>> = {
  'asset-unsupported-type': () => 'That is not a PNG, a JPEG or a WebP.',
  'asset-animated': () => 'An animated image is not accepted.',
  'asset-corrupt': () => 'The image could not be read.',
  'asset-dimensions': (slot) =>
    `The image is over ${String(SLOT_RULES[slot].side)} pixels on its longer side, or has too many pixels.`,
  'asset-timeout': () => 'The image took too long to decode. Try a smaller one.',
  'asset-too-large': (slot) => tooLarge(slot),
  'asset-cap': () =>
    `The tenant’s images would pass ${TENANT_IMAGE_CAP}. Delete one that no theme uses.`,
  'asset-busy': () => 'The server is busy decoding images. Try again in a moment.',
};

// What a refused upload says, in the console's own words and never the
// server's, which may name a decoder.
export function uploadFailureText(slot: ImageSlot, problem: Problem): string {
  const said = ASSET_PROBLEMS[problemSubtype(problem)]?.(slot);
  if (said !== undefined) return said;
  if (problem.status === 413) return tooLarge(slot);
  return 'The image was not uploaded.';
}

export const UPLOAD_LOST =
  'Could not confirm that the image was uploaded. Check before trying again.';

export const UPLOAD_FAULT =
  'The console could not upload the image. This is a fault in the console, not something you did.';

export interface InUse {
  // "Named by the draft of this tenant’s theme", one per referencing theme.
  lines: readonly string[];
  more: boolean;
}

function referenceLine(error: FieldError): string {
  const where = error.path === 'theme' ? 'This tenant’s theme' : `The theme at ${error.path}`;
  return `${where}: ${error.message}.`;
}

// What the server's detail says when more themes name the image than it lists;
// the mirror test holds this to the server's own sentence.
export const IN_USE_MORE = 'more than errors lists';

export function inUse(problem: Problem): InUse | null {
  if (!problemSubtype(problem).startsWith('asset-in-use')) return null;
  return {
    lines: (problem.errors ?? []).map(referenceLine),
    more: problem.detail?.includes(IN_USE_MORE) === true,
  };
}

export function inUseTitle(found: InUse): string {
  return `The image is still used by ${counted(found.lines.length, 'theme', 'themes')}${found.more ? ' or more' : ''}. Take it out of each and save, then delete it.`;
}

export const DELETE_TITLE = 'Delete this image?';

export const DELETE_BODY =
  'The stored image is removed. It cannot be deleted while a draft or a published theme names it.';

export const ALT_HOLD = 'Describe each logo before saving: alt text is required.';

export function imagesHold(values: ImageValues): string | undefined {
  const logos = [values['assets.logo'], values['assets.darkLogo']];
  return logos.some((logo) => logo !== null && altProblem(logo.alt) !== undefined)
    ? ALT_HOLD
    : undefined;
}

const UPLOADING_NAME = 'Uploading';

const CHUNK = 0x8000;

// Whatever the server says it is, a data address carries it into the page, so
// only the three types an upload can be stored as are shown.
export function imageDataUrl(bytes: Uint8Array, contentType: string | null): string | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!TYPES.includes(type)) return null;
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

// Whether a logo's alt text differs from the saved one.
export function altChanged(saved: ImageValues, now: ImageValues, slot: ImageSlot): boolean {
  const before = saved[imageField(slot)];
  const after = now[imageField(slot)];
  const was = before !== null && 'alt' in before ? before.alt : null;
  const is = after !== null && 'alt' in after ? after.alt : null;
  return was !== is && is !== null;
}
