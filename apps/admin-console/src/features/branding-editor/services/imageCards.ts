import type { ThemeView } from '#/features/branding-editor/types/theme';
import { ALT_LABEL, ALT_RULE, altProblem } from '#/features/branding-editor/services/logoAlt';
import {
  ACCEPTED_TYPE_LIST,
  limitText,
  SLOT_RULES,
} from '#/features/branding-editor/services/imageSlots';
import {
  DELETE_LABEL,
  IMAGES_LEAD,
  IMAGES_TITLE,
  REMOVE_LABEL,
  UPLOADING,
} from '#/features/branding-editor/services/imageSection';
import { DELETE_BODY, DELETE_TITLE } from '#/features/branding-editor/services/imageRefusals';
import {
  slotView,
  thumbnailAlt,
  THUMBNAIL_WORDS,
  type Thumbnail,
  type ThumbnailWords,
} from '#/features/branding-editor/services/imageThumbnails';
import type { SlotState } from '#/features/branding-editor/services/imageUpload';
import {
  imageField,
  type ImageSlot,
  type ImageValues,
} from '#/features/branding-editor/services/imageValues';
import { sourceReading } from '#/features/branding-editor/services/sources';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

export interface ImagesWords {
  title: string;
  lead: string;
  thumbnail: ThumbnailWords;
}

export const IMAGES_WORDS: ImagesWords = {
  title: IMAGES_TITLE,
  lead: IMAGES_LEAD,
  thumbnail: THUMBNAIL_WORDS,
};

// The confirmation of deleting a stored image.
export const IMAGE_DELETE_WORDS = {
  title: DELETE_TITLE,
  consequence: DELETE_BODY,
  confirmLabel: DELETE_LABEL,
} as const;

export interface SlotCard {
  slot: ImageSlot;
  legend: string;
  hints: string[];
  note: string;
  thumbnail: Thumbnail;
  picture: string;
  alt: {
    label: string;
    description: string;
    value: string;
    error: string | undefined;
    changed: boolean;
  } | null;
  accept: string[];
  upload: { name: string; text: string; busy: boolean };
  remove: { name: string; text: string };
  drop: { name: string; text: string; assetId: string } | null;
  error: string | null;
}

export interface SlotInput {
  scope: ThemeScope;
  view: ThemeView;
  values: ImageValues;
  state: SlotState;
  thumbnail: Thumbnail;
  altChanged: boolean;
}

// One slot as it reads on screen: its rules, the image it holds, and what
// can be done with it.
export function slotCard(slot: ImageSlot, input: SlotInput): SlotCard {
  const shown = slotView(slot, input.values, input.state.busy);
  const { assetId } = shown;
  return {
    slot,
    legend: shown.label,
    hints: [
      SLOT_RULES[slot].hint,
      sourceReading(input.scope, input.view, imageField(slot)),
      limitText(slot),
    ],
    note: shown.note,
    thumbnail: input.thumbnail,
    picture: thumbnailAlt(slot, shown.alt),
    alt:
      shown.alt === null
        ? null
        : {
            label: `${shown.label}: ${ALT_LABEL.toLowerCase()}`,
            description: ALT_RULE,
            value: shown.alt,
            error: altProblem(shown.alt),
            changed: input.altChanged,
          },
    accept: ACCEPTED_TYPE_LIST,
    upload: {
      name: shown.uploadName,
      text: input.state.busy ? UPLOADING : shown.uploadText,
      busy: input.state.busy,
    },
    remove: { name: shown.removeName, text: REMOVE_LABEL },
    drop: assetId === null ? null : { name: shown.deleteName, text: DELETE_LABEL, assetId },
    error: input.state.error,
  };
}
