import type { FieldError } from '@odudu/contracts/admin';
import type { Problem } from '#/shared/services/result';
import { problemSubtype } from '#/shared/services/failure';
import { bytesText, counted } from '#/shared/services/format';
import {
  SLOT_RULES,
  TENANT_IMAGE_CAP,
  ACCEPTED_TYPE_LIST,
} from '#/features/branding-editor/services/imageSlots';
import type { ImageSlot } from '#/features/branding-editor/services/imageValues';

// A file the server would refuse by its size or type, said before it is sent.
// The bytes and the decoded size are the server's to judge.
export function uploadRefusal(
  slot: ImageSlot,
  file: { type: string; size: number },
): string | null {
  const rule = SLOT_RULES[slot];
  if (file.type !== '' && !ACCEPTED_TYPE_LIST.includes(file.type)) {
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
// server's, which may name a decoder. `uploadFailureOf` takes a failure of any
// kind and uses this for the refusals.
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
