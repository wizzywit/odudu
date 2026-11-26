import { useEffect, useRef, type RefObject } from 'react';
import { GridList, GridListHeader, GridListSection } from 'react-aria-components';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { EmptyState } from '#/shared/ui/EmptyState';
import { LoadMore, LoadMoreFailed } from '#/shared/ui/LoadMore';
import { ListSkeleton } from '#/shared/ui/Skeleton';
import { Note } from '#/shared/ui/Note';
import type {
  ConversationRow,
  ConversationSection,
  ConversationsState,
} from '#/widgets/assistant-panel/types/conversations';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { ConversationItem } from '#/widgets/assistant-panel/ui/ConversationsView/ConversationItem';
import styles from '#/widgets/assistant-panel/ui/ConversationsView/ConversationsView.module.css';

function Rows({
  rows,
  state,
  words,
}: {
  rows: readonly ConversationRow[];
  state: ConversationsState;
  words: PanelWords;
}) {
  return rows.map((row) => (
    <ConversationItem
      key={row.id}
      row={row}
      current={row.id === state.currentId}
      leaving={row.id === state.leaving}
      now={state.now}
      handlers={state}
      words={words}
    />
  ));
}

function LoadSection({ section, words }: { section: ConversationSection; words: PanelWords }) {
  if (!section.more) return null;
  return (
    <div className={styles.more}>
      {section.moreFailed ? <LoadMoreFailed noun={words.conversationsNoun} /> : null}
      <LoadMore
        compact
        noun={words.conversationsNoun}
        loading={section.loadingMore}
        limited={section.limited}
        onPress={section.loadMore}
      />
    </div>
  );
}

function OpenList({
  state,
  words,
  gridRef,
}: {
  state: ConversationsState;
  words: PanelWords;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  const { opened } = state;
  if (opened.status === 'loading') {
    return (
      <div className={styles.state}>
        <ListSkeleton label={words.conversationsLoading} items={4} />
      </div>
    );
  }
  if (opened.status === 'failed') {
    return (
      <div className={styles.state}>
        <EmptyState
          variant="failed"
          title={words.conversationsFailed}
          action={<Button onPress={opened.retry}>{words.retry}</Button>}
        />
      </div>
    );
  }
  if (state.groups.length === 0) {
    return (
      <div className={styles.state}>
        <EmptyState variant="nothing-yet" title={words.conversationsEmptyTitle}>
          {words.conversationsEmptyText}
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <GridList
        ref={gridRef}
        aria-label={words.conversationsLabel}
        selectionMode="none"
        className={styles.grid ?? ''}
      >
        {state.groups.map((group) => (
          <GridListSection key={group.id} className={styles.section ?? ''}>
            <GridListHeader className={styles.group ?? ''}>{group.label}</GridListHeader>
            <Rows rows={group.rows} state={state} words={words} />
          </GridListSection>
        ))}
      </GridList>
      <LoadSection section={opened} words={words} />
    </>
  );
}

function ArchivedList({ state, words }: { state: ConversationsState; words: PanelWords }) {
  const { archived } = state;
  if (archived.status === 'loading') return null;
  if (archived.status === 'failed') {
    return (
      <div className={styles.archivedFailed}>
        <Note>{words.archivedFailed}</Note>
        <Button size="small" variant="quiet" onPress={archived.retry}>
          {words.retry}
        </Button>
      </div>
    );
  }
  if (archived.rows.length === 0) return null;
  return (
    <details className={styles.archived}>
      <summary className={styles.archivedSummary}>{state.archivedLabel}</summary>
      <GridList aria-label={words.archivedTitle} selectionMode="none" className={styles.grid ?? ''}>
        <Rows rows={archived.rows} state={state} words={words} />
      </GridList>
      <LoadSection section={archived} words={words} />
    </details>
  );
}

// Taken away from the page and the keyboard while the chat shows, and the
// heading takes the focus when it is brought back, so a screen reader starts
// at the top of the list.
function useShowFocus(open: boolean, headingRef: RefObject<HTMLHeadingElement | null>): void {
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, headingRef]);
}

// The person's own conversations, in a view that takes the panel's whole
// height and is left with Back. The chat stays mounted behind it, so what is
// running goes on.
export function ConversationsView({
  state,
  words,
}: {
  state: ConversationsState;
  words: PanelWords;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useShowFocus(state.open, headingRef);
  const { pending } = state;
  return (
    <section
      aria-labelledby="assistant-conversations-title"
      className={styles.view}
      data-away={!state.open || undefined}
      aria-hidden={!state.open || undefined}
      inert={!state.open}
    >
      <header className={styles.head}>
        <Button size="small" variant="quiet" onPress={state.hide}>
          {words.conversationsBack}
        </Button>
        <h2
          id="assistant-conversations-title"
          ref={headingRef}
          tabIndex={-1}
          className={styles.heading}
        >
          {words.conversationsTitle}
        </h2>
        <Button
          size="small"
          variant="secondary"
          aria-label={words.conversationsNew}
          onPress={state.onNew}
        >
          <span className={styles.full}>{words.conversationsNew}</span>
          <span className={styles.short} aria-hidden="true">
            {words.conversationsNewShort}
          </span>
        </Button>
      </header>
      <div className={styles.body}>
        <div className={styles.scroll}>
          <OpenList state={state} words={words} gridRef={gridRef} />
          <ArchivedList state={state} words={words} />
        </div>
        <div className={styles.dock}>
          {pending === null ? null : (
            <div className={styles.switch} role="alert">
              <Note tone="warning">{words.switchRunning}</Note>
              <div className={styles.switchActions}>
                <Button size="small" variant="primary" autoFocus onPress={state.onStopAndSwitch}>
                  {words.switchStop}
                </Button>
                <Button
                  size="small"
                  variant="quiet"
                  onPress={() => {
                    state.onKeepWaiting();
                    gridRef.current?.focus();
                  }}
                >
                  {words.switchWait}
                </Button>
              </div>
            </div>
          )}
          <div role="status" aria-live="polite" className={styles.undoRegion}>
            {state.undo === null ? null : (
              <p className={styles.undo}>
                <span>{words.undoArchived}</span>
                <Button size="small" variant="quiet" onPress={state.onUndo}>
                  {words.undo}
                </Button>
              </p>
            )}
          </div>
        </div>
      </div>
      <p className={styles.retention}>{words.conversationsRetention}</p>
      <ConfirmDialog
        isOpen={state.deleting !== null}
        title={words.deleteTitle}
        consequence={
          <>
            <strong className={styles.deleting}>{state.deleting?.title}</strong>
            {words.deleteConsequence}
          </>
        }
        confirmLabel={words.deleteConfirm}
        tone="danger"
        busy={state.deleteBusy}
        problem={state.deleteProblem}
        onConfirm={state.onConfirmDelete}
        onCancel={state.onCancelDelete}
      />
    </section>
  );
}
