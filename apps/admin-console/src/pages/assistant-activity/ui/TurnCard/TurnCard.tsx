import { useId } from 'react';
import type { EventView, StepView, TurnView } from '#/pages/assistant-activity/services/replayView';
import type { ReplayPage } from '#/pages/assistant-activity/use-cases/useReplayPage';
import { Button } from '#/shared/ui/Button';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/assistant-activity/ui/TurnCard/TurnCard.module.css';

function Entry({ event, inPart }: { event: EventView; inPart: string }) {
  return (
    <li className={styles.entry} data-kind={event.kind}>
      <span className={styles.entryHead}>
        <strong>{event.label}</strong>
        {event.detail === null ? null : <span className={styles.muted}>{event.detail}</span>}
      </span>
      {event.body === null ? null : <pre className={styles.body}>{event.body}</pre>}
      {event.cut ? <span className={styles.muted}>{inPart}</span> : null}
    </li>
  );
}

function Entries({ events, inPart }: { events: readonly EventView[]; inPart: string }) {
  return (
    <ol className={styles.entries}>
      {events.map((event) => (
        <Entry key={event.key} event={event} inPart={inPart} />
      ))}
    </ol>
  );
}

function Step({ step, inPart }: { step: StepView; inPart: string }) {
  return (
    <li className={styles.step}>
      <p className={styles.stepHead}>
        <strong>{step.heading}</strong>
        <span>{step.meta}</span>
        <span className={styles.muted}>{step.tokens}</span>
      </p>
      {step.events.length === 0 ? null : <Entries events={step.events} inPart={inPart} />}
    </li>
  );
}

export function TurnCard({
  turn,
  page,
}: {
  turn: TurnView;
  page: Pick<ReplayPage, 'words' | 'tone' | 'toggle' | 'showMore'>;
}) {
  const body = useId();
  const { words } = page;
  return (
    <article className={styles.card} aria-label={turn.title}>
      <header className={styles.header}>
        <h3 className={styles.title}>{turn.title}</h3>
        <StatusTag tone={page.tone(turn.stopReason)}>{turn.outcome}</StatusTag>
        <span className={styles.muted}>
          <Timestamp value={turn.startedAt} />
        </span>
        <Button
          size="small"
          variant="quiet"
          aria-expanded={turn.open}
          aria-controls={body}
          aria-label={`${turn.open ? words.hide : words.show}, ${turn.title}`}
          onPress={() => {
            page.toggle(turn);
          }}
        >
          {turn.open ? words.hide : words.show}
        </Button>
      </header>
      <div id={body} hidden={!turn.open} className={styles.content}>
        <p>
          <strong>{words.whyStopped}.</strong> {turn.whyStopped}
        </p>
        {turn.whyModels.length === 0 ? null : (
          <div>
            <h4 className={styles.sub}>{words.whyModel}</h4>
            <ul className={styles.plainList}>
              {turn.whyModels.map((why) => (
                <li key={why}>{why}</li>
              ))}
            </ul>
          </div>
        )}
        {turn.decisions.length === 0 ? null : (
          <div>
            <h4 className={styles.sub}>{words.decisions}</h4>
            <Entries events={turn.decisions} inPart={words.inPart} />
          </div>
        )}
        {turn.steps.length === 0 ? null : (
          <div>
            <h4 className={styles.sub}>{words.steps}</h4>
            <ol className={styles.steps}>
              {turn.steps.map((step) => (
                <Step key={step.id} step={step} inPart={words.inPart} />
              ))}
            </ol>
          </div>
        )}
        {turn.notShown === 0 ? null : (
          <p className={styles.more}>
            <span className={styles.muted}>{words.notShown(turn.notShown)}</span>
            <Button
              size="small"
              onPress={() => {
                page.showMore(turn);
              }}
            >
              {words.more(turn.nextCount)}
            </Button>
          </p>
        )}
      </div>
    </article>
  );
}
