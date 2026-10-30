import { PREVIEW_LOADING } from '#/features/branding/service';
import styles from '#/features/branding/view/PreviewFrame/PreviewFrame.module.css';

export interface PreviewFrameProps {
  title: string;
  src: string;
  // Reloads the frame when what it shows has changed.
  frameKey: string;
  loading: boolean;
  onLoaded: () => void;
}

// A page of the server in a frame that may run nothing and shares no origin
// with the console. Its height is fixed, so the page does not move when the
// frame reloads. Beside a narrow editor the same frame is drawn as a
// miniature, and `fill` is the one in the sheet that takes the room it is given.
export function PreviewFrame({
  title,
  src,
  frameKey,
  loading,
  onLoaded,
  fill = false,
  tabbable = true,
}: PreviewFrameProps & { fill?: boolean; tabbable?: boolean }) {
  return (
    <div className={styles.frame} data-loading={loading || undefined} data-fill={fill || undefined}>
      <iframe
        key={frameKey}
        className={styles.iframe}
        title={title}
        tabIndex={tabbable ? undefined : -1}
        src={src}
        sandbox=""
        referrerPolicy="no-referrer"
        onLoad={onLoaded}
      />
      {loading ? (
        <p role="status" className={styles.loading}>
          {PREVIEW_LOADING}
        </p>
      ) : null}
    </div>
  );
}
