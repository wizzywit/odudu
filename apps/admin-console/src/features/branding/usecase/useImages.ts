import type { ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useAssetUpload } from '#/features/branding/repository/useThemeAssets';
import { useSlotImages } from '#/features/branding/repository/useSlotImages';
import { imageSave } from '#/features/branding/repository/themeSaves';
import {
  altChanged,
  editAlt,
  finishUpload,
  forgetImage,
  IDLE_SLOTS,
  imageField,
  imageFields,
  imageValues,
  imagesHold,
  IMAGES_TITLE,
  slotAfterUpload,
  slotAssetIds,
  startUpload,
  themeRecord,
  type ImageValues,
  type ImageSlot,
  type SlotStates,
  type Thumbnail,
  type ThemeScope,
  themeRefusal,
  writeCapability,
} from '#/features/branding/service';
import { useLatest } from '#/shared/repository/useLatest';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';

export interface Images {
  save: SectionSave<ImageValues>;
  blocked: string | undefined;
  slots: SlotStates;
  // What each slot's image looks like, as it is held now, saved or not.
  thumbnails: Record<ImageSlot, Thumbnail>;
  upload: (slot: ImageSlot, file: File) => void;
  setAlt: (slot: 'logo' | 'darkLogo', alt: string) => void;
  remove: (slot: ImageSlot) => void;
  // Takes a deleted image out of the slot that still names it.
  forget: (slot: ImageSlot, assetId: string) => void;
  // Whether a logo's alt text differs from the saved one.
  altChanged: (slot: ImageSlot) => boolean;
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
  return {
    save,
    thumbnails,
    blocked: imagesHold(save.values),
    slots,
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
    altChanged: (slot) => altChanged(saved, save.values, slot),
  };
}
