import type {
  Thumbnail,
  ThumbnailWords,
} from '#/features/branding-editor/services/imageThumbnails';
import { Button } from '#/shared/ui/Button';
import styles from '#/features/branding-editor/ui/SlotThumbnail/SlotThumbnail.module.css';

// The image a slot holds, small and whole, so that what was uploaded is what
// is seen before anything publishes it.
export function SlotThumbnail({
  thumbnail,
  alt,
  words,
}: {
  thumbnail: Thumbnail;
  alt: string;
  words: ThumbnailWords;
}) {
  if (thumbnail.status === 'none') return null;
  if (thumbnail.status === 'ready') {
    return <img className={styles.picture} src={thumbnail.data} alt={alt} />;
  }
  if (thumbnail.status === 'loading') {
    return (
      <p role="status" className={styles.note}>
        {words.loading}
      </p>
    );
  }
  return (
    <div className={styles.failed}>
      <p className={styles.note}>{words.failed}</p>
      <Button variant="quiet" onPress={thumbnail.retry}>
        {words.retry}
      </Button>
    </div>
  );
}
