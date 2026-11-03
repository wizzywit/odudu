import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { ScopeBranding } from '#/features/branding-editor/use-cases/useScopeBranding';
import { usePublicationBar } from '#/features/branding-editor/use-cases/usePublicationBar';
import { RevertConflict } from '#/features/branding-editor/ui/RevertConflict';
import { ActionMenu } from '#/shared/ui/ActionMenu';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { Note } from '#/shared/ui/Note';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { StatusTag } from '#/shared/ui/StatusTag';
import styles from '#/features/branding-editor/ui/PublicationBar/PublicationBar.module.css';

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
  const { publication, discard, revert, bar } = usePublicationBar({
    tenant,
    scope: branding.scope,
    view,
    tag,
    tab,
    published: branding.published,
    onPublished: branding.setPublished,
  });
  const { status, publish, notes, outcome } = bar;
  return (
    <div className={styles.bar}>
      <Panel title={status.title} headingClassName={styles.title ?? ''}>
        <div className={styles.row}>
          <div className={styles.summary}>
            <p className={recordTab.text}>
              <StatusTag tone={status.tag.tone}>
                <span className={styles.full}>{status.tag.text}</span>
                <span className={styles.brief} title={status.tag.text}>
                  {status.short}
                </span>
              </StatusTag>{' '}
              <span className={styles.published}>{status.published}</span>
            </p>
            <p className={recordTab.rule}>
              <span className={styles.sentence}>{status.sentence}</span>
              <span className={styles.count} title={status.sentence}>
                {status.brief}
              </span>
            </p>
            <p className={`${recordTab.rule ?? ''} ${styles.explain ?? ''}`}>{status.explain}</p>
          </div>
          <div className={styles.hold}>
            {notes.publish === undefined ? null : <Note tone="warning">{notes.publish}</Note>}
            {notes.discard === undefined ? null : <Note tone="warning">{notes.discard}</Note>}
          </div>
          <div className={`${recordTab.actions ?? ''} ${styles.actions ?? ''}`}>
            <Button
              variant="primary"
              aria-label={publish.label}
              isDisabled={publication.hold !== undefined}
              onPress={publication.publish}
            >
              <span className={styles.full}>{publish.label}</span>
              <span className={styles.brief}>{publish.short}</span>
            </Button>
            <div className={styles.inline}>
              <Button isDisabled={bar.discard.disabled} onPress={discard.ask}>
                {bar.discard.label}
              </Button>
            </div>
            <div className={styles.folded}>
              <ActionMenu
                label={bar.menu.label}
                trigger={bar.menu.trigger}
                actions={bar.menu.actions}
              />
            </div>
          </div>
        </div>
        <div role="status" className={styles.outcome}>
          {outcome.message === null ? null : <p className={styles.refused}>{outcome.message}</p>}
          {outcome.problem === null ? null : <p className={styles.refused}>{outcome.problem}</p>}
          {outcome.issues === null ? null : (
            <>
              <p className={recordTab.rule}>{outcome.issues.label}</p>
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
          {outcome.warnings === null ? null : (
            <>
              <p className={recordTab.text}>
                <strong>{outcome.warnings.title}</strong>
              </p>
              <p className={recordTab.rule}>{outcome.warnings.note}</p>
              <ul className={styles.issues}>
                {outcome.warnings.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <RevertConflict revert={revert} />
        <ConfirmDialog
          isOpen={discard.confirming}
          title={bar.discard.dialog.title}
          consequence={bar.discard.dialog.consequence}
          confirmLabel={bar.discard.dialog.confirmLabel}
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
