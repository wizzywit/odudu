import type { ThemeView } from '@odudu/contracts/admin';
import {
  barText,
  changeBrief,
  discardNote,
  foldedActions,
  DISCARD_CONFIRM,
  DISCARD_LABEL,
  DISCARD_TITLE,
  discardBody,
  ISSUES_LABEL,
  MORE_LABEL,
  MORE_TRIGGER,
  PUBLISH_BODY,
  PUBLISH_LABEL,
  PUBLISH_TITLE,
  PUBLISHING,
  publishedShort,
  publishedTag,
  PUBLISH_SHORT,
  publishedText,
  WARNINGS_NOTE,
  WARNINGS_TITLE,
} from '#/features/branding/service';
import type { ScopeBranding } from '#/features/branding/usecase/useScopeBranding';
import { usePublicationBar } from '#/features/branding/usecase/usePublicationBar';
import { ActionMenu } from '#/shared/view/ActionMenu';
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
  tab,
}: {
  tenant: string;
  branding: ScopeBranding;
  view: ThemeView;
  tag: string;
  // The tab being shown, whose parts a revert from the narrow bar takes back.
  tab: string;
}) {
  const { scope } = branding;
  const { publication, discard, revert, revertOffered, revertTab, holds } = usePublicationBar({
    tenant,
    scope,
    view,
    tag,
    tab,
    published: branding.published,
    onPublished: branding.setPublished,
  });
  const { outcome } = publication;
  const state = publishedTag(view);
  const brief = changeBrief(view);
  const note = discardNote(holds, view.draft !== null, publication.hold);
  const handlers = { revert: revert.revert, discard: discard.ask };
  return (
    <div className={styles.bar}>
      <Panel title={PUBLISH_TITLE} headingClassName={styles.title ?? ''}>
        <div className={styles.row}>
          <div className={styles.summary}>
            <p className={recordTab.text}>
              <StatusTag tone={state.tone}>
                <span className={styles.full}>{state.text}</span>
                <span className={styles.brief} title={state.text}>
                  {publishedShort(view)}
                </span>
              </StatusTag>{' '}
              <span className={styles.published}>{publishedText(view)}</span>
            </p>
            <p className={recordTab.rule}>
              <span className={styles.sentence}>{barText(view)}</span>
              <span className={styles.count} title={barText(view)}>
                {brief}
              </span>
            </p>
            <p className={`${recordTab.rule ?? ''} ${styles.explain ?? ''}`}>{PUBLISH_BODY}</p>
          </div>
          <div className={styles.hold}>
            {publication.hold === undefined ? null : <Note tone="warning">{publication.hold}</Note>}
            {note === undefined ? null : <Note tone="warning">{note}</Note>}
          </div>
          <div className={`${recordTab.actions ?? ''} ${styles.actions ?? ''}`}>
            <Button
              variant="primary"
              aria-label={publication.busy ? PUBLISHING : PUBLISH_LABEL}
              isDisabled={publication.hold !== undefined}
              onPress={publication.publish}
            >
              <span className={styles.full}>{publication.busy ? PUBLISHING : PUBLISH_LABEL}</span>
              <span className={styles.brief}>{publication.busy ? PUBLISHING : PUBLISH_SHORT}</span>
            </Button>
            <div className={styles.inline}>
              <Button isDisabled={holds.discard !== undefined} onPress={discard.ask}>
                {DISCARD_LABEL}
              </Button>
            </div>
            <div className={styles.folded}>
              <ActionMenu
                label={MORE_LABEL}
                trigger={MORE_TRIGGER}
                actions={foldedActions({
                  holds,
                  tab: revertTab,
                  revertOffered,
                  reverting: revert.busy,
                }).map((action) => ({ ...action, onAction: handlers[action.id] }))}
              />
            </div>
          </div>
        </div>
        <div role="status" className={styles.outcome}>
          {outcome.message === null ? null : <p className={styles.refused}>{outcome.message}</p>}
          {revert.problem === null ? null : <p className={styles.refused}>{revert.problem}</p>}
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
