import { Button } from '#/shared/ui/Button';
import type { FirstRunNotice as Notice } from '#/widgets/assistant-panel/types/firstRun';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import styles from '#/widgets/assistant-panel/ui/FirstRunNotice/FirstRunNotice.module.css';

// Said once, before the first message: where the person's words go, and who
// can read the conversation afterwards. It does not take the focus.
export function FirstRunNotice({
  notice,
  words,
  onDismiss,
}: {
  notice: Notice;
  words: PanelWords;
  onDismiss: () => void;
}) {
  return (
    <section className={styles.notice} aria-labelledby="assistant-first-run-title">
      <h3 id="assistant-first-run-title" className={styles.title}>
        {words.firstRunTitle}
      </h3>
      <p className={styles.text}>{notice.sentTo}</p>
      <p className={styles.text}>{notice.seenBy}</p>
      {notice.acting === null ? null : <p className={styles.text}>{notice.acting}</p>}
      <div className={styles.action}>
        <Button size="small" onPress={onDismiss}>
          {words.firstRunDismiss}
        </Button>
      </div>
    </section>
  );
}
