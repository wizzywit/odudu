import type { ThemeView } from '@odudu/contracts/admin';
import {
  barText,
  DISCARD_CONFIRM,
  DISCARD_LABEL,
  DISCARD_TITLE,
  discardBody,
  ISSUES_LABEL,
  PUBLISH_BODY,
  PUBLISH_LABEL,
  PUBLISH_TITLE,
  PUBLISHING,
  publishedTag,
  publishedText,
  WARNINGS_NOTE,
  WARNINGS_TITLE,
} from '#/features/branding/service';
import type { ScopeBranding } from '#/features/branding/usecase/useScopeBranding';
import { usePublicationBar } from '#/features/branding/usecase/usePublicationBar';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { Note } from '#/shared/view/Note';
import { Panel } from '#/shared/view/Panel';
import { recordTab } from '#/shared/view/RecordTab';
import { StatusTag } from '#/shared/view/StatusTag';
import styles from '#/features/branding/view/PublicationBar/PublicationBar.module.css';

// Above every tab of a scope's theme: what people see, what the draft would
// change, and the two things done with the draft as a whole.
export function PublicationBar({
  tenant,
  branding,
  view,
  tag,
}: {
  tenant: string;
  branding: ScopeBranding;
  view: ThemeView;
  tag: string;
}) {
  const { scope } = branding;
  const { publication, discard } = usePublicationBar({
    tenant,
    scope,
    view,
    tag,
    published: branding.published,
    onPublished: branding.setPublished,
  });
  const { outcome } = publication;
  const state = publishedTag(view);
  return (
    <div className={styles.bar}>
      <Panel title={PUBLISH_TITLE}>
        <p className={recordTab.text}>
          <StatusTag tone={state.tone}>{state.text}</StatusTag> {publishedText(view)}
        </p>
        <p className={recordTab.rule}>{barText(view)}</p>
        <p className={recordTab.rule}>{PUBLISH_BODY}</p>
        {publication.hold === undefined ? null : <Note tone="warning">{publication.hold}</Note>}
        <div className={recordTab.actions}>
          <Button
            variant="primary"
            isDisabled={publication.busy || publication.hold !== undefined}
            onPress={publication.publish}
          >
            {publication.busy ? PUBLISHING : PUBLISH_LABEL}
          </Button>
          <Button isDisabled={view.draft === null} onPress={discard.ask}>
            {DISCARD_LABEL}
          </Button>
        </div>
        <div role="status" className={styles.outcome}>
          {outcome.message === null ? null : <p className={styles.refused}>{outcome.message}</p>}
          {outcome.issues.lines.length === 0 ? null : (
            <>
              <p className={recordTab.rule}>{ISSUES_LABEL}</p>
              <ul className={styles.issues}>
                {outcome.issues.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {outcome.issues.more === null ? null : (
                <p className={recordTab.rule}>{outcome.issues.more}</p>
              )}
            </>
          )}
          {outcome.warnings.length === 0 ? null : (
            <>
              <p className={recordTab.text}>
                <strong>{WARNINGS_TITLE}</strong>
              </p>
              <p className={recordTab.rule}>{WARNINGS_NOTE}</p>
              <ul className={styles.issues}>
                {outcome.warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <ConfirmDialog
          isOpen={discard.confirming}
          title={DISCARD_TITLE}
          consequence={discardBody(scope)}
          confirmLabel={DISCARD_CONFIRM}
          tone="danger"
          busy={discard.busy}
          problem={discard.problem}
          onConfirm={discard.confirm}
          onCancel={discard.cancel}
        />
      </Panel>
    </div>
  );
}
