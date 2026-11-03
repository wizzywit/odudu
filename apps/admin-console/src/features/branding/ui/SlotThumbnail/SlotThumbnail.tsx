import {
  THUMBNAIL_FAILED,
  THUMBNAIL_LOADING,
  THUMBNAIL_RETRY,
  thumbnailAlt,
  type Thumbnail,
} from '#/features/branding/services/imageThumbnails';
import type { ImageSlot } from '#/features/branding/services/imageValues';
import { Button } from '#/shared/ui/Button';
import styles from '#/features/branding/ui/SlotThumbnail/SlotThumbnail.module.css';

// The image a slot holds, small and whole, so that what was uploaded is what
// is seen before anything publishes it.
export function SlotThumbnail({
  slot,
  thumbnail,
  alt,
}: {
  slot: ImageSlot;
  thumbnail: Thumbnail;
  alt: string | null;
}) {
  if (thumbnail.status === 'none') return null;
  if (thumbnail.status === 'ready') {
    return <img className={styles.picture} src={thumbnail.data} alt={thumbnailAlt(slot, alt)} />;
  }
  if (thumbnail.status === 'loading') {
    return (
      <p role="status" className={styles.note}>
        {THUMBNAIL_LOADING}
      </p>
    );
  }
  return (
    <div className={styles.failed}>
      <p className={styles.note}>{THUMBNAIL_FAILED}</p>
      <Button variant="quiet" onPress={thumbnail.retry}>
        {THUMBNAIL_RETRY}
      </Button>
    </div>
  );
}
