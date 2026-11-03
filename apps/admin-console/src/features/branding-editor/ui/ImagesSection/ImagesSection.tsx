import { FileTrigger } from 'react-aria-components';
import type { SlotCard } from '#/features/branding-editor/services/imageCards';
import type { Images } from '#/features/branding-editor/use-cases/useImages';
import type { ImageAsk } from '#/features/branding-editor/use-cases/useImageDeletion';
import { Button } from '#/shared/ui/Button';
import { TextField } from '#/shared/ui/Field';
import { SlotThumbnail } from '#/features/branding-editor/ui/SlotThumbnail';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/features/branding-editor/ui/ImagesSection/ImagesSection.module.css';

function Slot({
  card,
  images,
  onDelete,
}: {
  card: SlotCard;
  images: Images;
  onDelete: (ask: ImageAsk) => void;
}) {
  const { slot, alt, drop } = card;
  return (
    <fieldset className={styles.slot}>
      <legend className={styles.legend}>{card.legend}</legend>
      {card.hints.map((hint) => (
        <p key={hint} className={styles.hint}>
          {hint}
        </p>
      ))}
      <p className={styles.state}>{card.note}</p>
      <SlotThumbnail thumbnail={card.thumbnail} alt={card.picture} words={images.words.thumbnail} />
      {alt === null ? null : (
        <TextField
          label={alt.label}
          description={alt.description}
          value={alt.value}
          error={alt.error}
          changed={alt.changed}
          onChange={(text) => {
            images.setAlt(slot, text);
          }}
        />
      )}
      <div className={styles.actions}>
        <FileTrigger
          acceptedFileTypes={card.accept}
          onSelect={(files) => {
            const file = files?.item(0);
            if (file !== null && file !== undefined) images.upload(slot, file);
          }}
        >
          <Button isDisabled={card.upload.busy} aria-label={card.upload.name}>
            {card.upload.text}
          </Button>
        </FileTrigger>
        {drop === null ? null : (
          <>
            <Button
              variant="quiet"
              aria-label={card.remove.name}
              onPress={() => {
                images.remove(slot);
              }}
            >
              {card.remove.text}
            </Button>
            <Button
              variant="quiet"
              aria-label={drop.name}
              onPress={() => {
                onDelete({ slot, assetId: drop.assetId });
              }}
            >
              {drop.text}
            </Button>
          </>
        )}
      </div>
      <p role="alert" className={styles.error}>
        {card.error}
      </p>
    </fieldset>
  );
}

export function ImagesSection({
  images,
  onDelete,
}: {
  images: Images;
  onDelete: (ask: ImageAsk) => void;
}) {
  return (
    <SaveSection
      title={images.words.title}
      description={images.words.lead}
      blocked={images.blocked}
      save={images.save}
    >
      {images.cards.map((card) => (
        <Slot key={card.slot} card={card} images={images} onDelete={onDelete} />
      ))}
    </SaveSection>
  );
}
