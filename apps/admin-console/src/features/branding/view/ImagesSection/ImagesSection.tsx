import { FileTrigger } from 'react-aria-components';
import type { ThemeView } from '@odudu/contracts/admin';
import {
  ACCEPTED_TYPES,
  ALT_LABEL,
  ALT_RULE,
  altProblem,
  DELETE_LABEL,
  IMAGE_SLOTS,
  IMAGES_LEAD,
  IMAGES_TITLE,
  imageField,
  limitText,
  REMOVE_LABEL,
  SLOT_RULES,
  slotView,
  sourceReading,
  UPLOADING,
  type ImageSlot,
  type ThemeScope,
} from '#/features/branding/service';
import type { Images } from '#/features/branding/usecase/useImages';
import type { ImageAsk } from '#/features/branding/usecase/useImageDeletion';
import { Button } from '#/shared/view/Button';
import { TextField } from '#/shared/view/Field';
import { SlotThumbnail } from '#/features/branding/view/SlotThumbnail';
import { SaveSection } from '#/shared/view/SaveSection';
import styles from '#/features/branding/view/ImagesSection/ImagesSection.module.css';

function Slot({
  slot,
  scope,
  view,
  images,
  onDelete,
}: {
  slot: ImageSlot;
  scope: ThemeScope;
  view: ThemeView;
  images: Images;
  onDelete: (ask: ImageAsk) => void;
}) {
  const state = images.slots[slot];
  const shown = slotView(slot, images.save.values, state.busy);
  const { assetId } = shown;
  return (
    <fieldset className={styles.slot}>
      <legend className={styles.legend}>{shown.label}</legend>
      <p className={styles.hint}>{SLOT_RULES[slot].hint}</p>
      <p className={styles.hint}>{sourceReading(scope, view, imageField(slot))}</p>
      <p className={styles.hint}>{limitText(slot)}</p>
      <p className={styles.state}>{shown.note}</p>
      <SlotThumbnail slot={slot} thumbnail={images.thumbnails[slot]} alt={shown.alt} />
      {shown.alt === null ? null : (
        <TextField
          label={`${shown.label}: ${ALT_LABEL.toLowerCase()}`}
          description={ALT_RULE}
          value={shown.alt}
          error={altProblem(shown.alt)}
          changed={images.altChanged(slot)}
          onChange={(alt) => {
            if (slot === 'logo' || slot === 'darkLogo') images.setAlt(slot, alt);
          }}
        />
      )}
      <div className={styles.actions}>
        <FileTrigger
          acceptedFileTypes={ACCEPTED_TYPES.split(',')}
          onSelect={(files) => {
            const file = files?.item(0);
            if (file !== null && file !== undefined) images.upload(slot, file);
          }}
        >
          <Button isDisabled={state.busy} aria-label={shown.uploadName}>
            {state.busy ? UPLOADING : shown.uploadText}
          </Button>
        </FileTrigger>
        {assetId === null ? null : (
          <>
            <Button
              variant="quiet"
              aria-label={shown.removeName}
              onPress={() => {
                images.remove(slot);
              }}
            >
              {REMOVE_LABEL}
            </Button>
            <Button
              variant="quiet"
              aria-label={shown.deleteName}
              onPress={() => {
                onDelete({ slot, assetId });
              }}
            >
              {DELETE_LABEL}
            </Button>
          </>
        )}
      </div>
      <p role="alert" className={styles.error}>
        {state.error}
      </p>
    </fieldset>
  );
}

export function ImagesSection({
  scope,
  view,
  images,
  onDelete,
}: {
  scope: ThemeScope;
  view: ThemeView;
  images: Images;
  onDelete: (ask: ImageAsk) => void;
}) {
  const blocked = images.blocked;
  return (
    <SaveSection
      title={IMAGES_TITLE}
      description={IMAGES_LEAD}
      blocked={blocked}
      save={images.save}
    >
      {IMAGE_SLOTS.map((slot) => (
        <Slot
          key={slot}
          slot={slot}
          scope={scope}
          view={view}
          images={images}
          onDelete={onDelete}
        />
      ))}
    </SaveSection>
  );
}
