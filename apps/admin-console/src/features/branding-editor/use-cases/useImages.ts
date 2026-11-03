import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useAssetUpload } from '#/features/branding-editor/repository/useThemeAssets';
import { useSlotImages } from '#/features/branding-editor/repository/useSlotImages';
import { imageSave } from '#/features/branding-editor/repository/themeSaves';
import {
  themeRefusal,
  writeCapability,
  themeRecord,
  type ThemeScope,
} from '#/features/branding-editor/services/themeScope';
import { altChanged, imagesHold } from '#/features/branding-editor/services/logoAlt';
import { slotAssetIds } from '#/features/branding-editor/services/imageThumbnails';
import {
  IMAGES_WORDS,
  slotCard,
  type ImagesWords,
  type SlotCard,
} from '#/features/branding-editor/services/imageCards';
import {
  editAlt,
  finishUpload,
  forgetImage,
  IDLE_SLOTS,
  slotAfterUpload,
  startUpload,
} from '#/features/branding-editor/services/imageUpload';
import {
  IMAGE_SLOTS,
  imageField,
  imageValues,
  type ImageValues,
  type ImageSlot,
} from '#/features/branding-editor/services/imageValues';
import { imageFields, IMAGES_TITLE } from '#/features/branding-editor/services/imageSection';
import { useSectionHold } from '#/features/branding-editor/use-cases/useSectionHold';
import { useLatest } from '#/shared/repository/useLatest';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';

export interface Images {
  save: SectionSave<ImageValues>;
  blocked: string | undefined;
  words: ImagesWords;
  // Each slot, with the image it holds now, saved or not.
  cards: SlotCard[];
  upload: (slot: ImageSlot, file: File) => void;
  setAlt: (slot: ImageSlot, alt: string) => void;
  remove: (slot: ImageSlot) => void;
  // Takes a deleted image out of the slot that still names it.
  forget: (slot: ImageSlot, assetId: string) => void;
}

export function useImages({
  tenant,
  scope,
  view,
  tag,
  gone,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
}): Images {
  const refusal = useRefusal(tenant);
  const uploading = useAssetUpload(tenant);
  const [slots, setSlots] = useState(IDLE_SLOTS);
  const saved = imageValues(view);
  const save = useSectionSave({
    tenant,
    record: themeRecord(scope),
    section: 'images',
    label: IMAGES_TITLE,
    etag: tag,
    capability: writeCapability(scope),
    gone,
    refusal,
    explain: themeRefusal(scope),
    fields: imageFields(imageValues(view)),
    save: imageSave(tenant, scope, view),
  });
  const latestValues = useLatest(save.values);
  const thumbnails = useSlotImages(tenant, slotAssetIds(save.values));
  const blocked = useSectionHold(tenant, scope, imagesHold(save.values), save.saving);
  return {
    save,
    words: IMAGES_WORDS,
    cards: IMAGE_SLOTS.map((slot) =>
      slotCard(slot, {
        scope,
        view,
        values: save.values,
        state: slots[slot],
        thumbnail: thumbnails[slot],
        altChanged: altChanged(saved, save.values, slot),
      }),
    ),
    blocked,
    upload: (slot, file) => {
      startUpload(slot, file, {
        show: setSlots,
        send: () => {
          uploading
            .run({ kind: slot, file })
            .then((result) => {
              finishUpload(slot, result, latestValues(), {
                show: setSlots,
                edit: (at, image) => {
                  save.edit(imageField(at), image);
                },
                report: (failure) => {
                  refusal.report(failure, writeCapability(scope));
                },
              });
            })
            .catch(() => {
              setSlots((was) => slotAfterUpload(was, slot, { ok: false, kind: 'defect' }));
            });
        },
      });
    },
    setAlt: (slot, alt) => {
      editAlt(save.values, slot, alt, (at, logo) => {
        save.edit(imageField(at), logo);
      });
    },
    remove: (slot) => {
      save.edit(imageField(slot), null);
    },
    forget: (slot, assetId) => {
      forgetImage(latestValues(), slot, assetId, (at, image) => {
        save.edit(imageField(at), image);
      });
    },
  };
}
