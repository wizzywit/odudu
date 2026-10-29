import { useId, type ReactNode } from 'react';
import {
  PREVIEW_CLOSE_LABEL,
  PREVIEW_OPEN_LABEL,
  PREVIEW_SHEET_TITLE,
} from '#/features/branding/service';
import { usePreviewSheet } from '#/features/branding/usecase/usePreviewSheet';
import { PreviewFrame, type PreviewFrameProps } from '#/features/branding/view/PreviewFrame';
import { Button } from '#/shared/view/Button';
import { DialogFrame } from '#/shared/view/DialogFrame';
import { NativeSelectFields } from '#/shared/view/Field';
import styles from '#/features/branding/view/PreviewShell/PreviewShell.module.css';

// A preview of a page beside its editor. Where the editor has the width, it
// is a panel: the choices of what to show, what the preview is, and the frame.
// Where the editor is stacked, it is a strip pinned under what is being
// edited: a miniature, what it shows, and a button that opens the same
// preview as a sheet at the page's real proportions.
export function PreviewShell({
  title,
  summary,
  lead,
  controls,
  notes,
  live,
  frame,
}: {
  title: string;
  // What the strip says is shown.
  summary: string;
  // The preview's own caption, also the sheet's description.
  lead: string;
  // The choices of which page, scheme and language.
  controls: ReactNode;
  notes?: ReactNode;
  // A notice area kept in the page for announcements.
  live?: ReactNode;
  frame: PreviewFrameProps;
}) {
  const heading = useId();
  const sheet = usePreviewSheet();
  return (
    <section aria-labelledby={heading} className={styles.pane}>
      <h2 id={heading} className={styles.title}>
        {title}
      </h2>
      <div className={styles.controls}>{controls}</div>
      <p className={styles.lead}>{lead}</p>
      <div className={styles.notes}>{notes}</div>
      <div className={styles.live}>{live}</div>
      <div className={styles.stage}>
        <PreviewFrame {...frame} />
      </div>
      <p className={styles.summary}>{summary}</p>
      <div className={styles.open}>
        <Button onPress={sheet.open}>{PREVIEW_OPEN_LABEL}</Button>
      </div>
      <DialogFrame
        isOpen={sheet.isOpen}
        size="sheet"
        title={PREVIEW_SHEET_TITLE}
        description={lead}
        onEscape={sheet.close}
        actions={<Button onPress={sheet.close}>{PREVIEW_CLOSE_LABEL}</Button>}
      >
        <div className={styles.switches}>
          <NativeSelectFields>{controls}</NativeSelectFields>
        </div>
        <div className={styles.notes}>{notes}</div>
        <div className={styles.live}>{live}</div>
        <PreviewFrame {...frame} fill />
      </DialogFrame>
    </section>
  );
}
