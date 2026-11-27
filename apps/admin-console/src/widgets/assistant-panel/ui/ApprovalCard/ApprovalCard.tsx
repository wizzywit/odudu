import { useId } from 'react';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { Problem } from '#/shared/ui/Message';
import type { CardModel } from '#/widgets/assistant-panel/types/approvals';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import { ChangeDiff } from '#/widgets/assistant-panel/ui/ChangeDiff';
import { SetDiff } from '#/widgets/assistant-panel/ui/SetDiff';
import { Countdown } from '#/widgets/assistant-panel/ui/Countdown';
import styles from '#/widgets/assistant-panel/ui/ApprovalCard/ApprovalCard.module.css';

// A change the assistant proposes, drawn from what the server stored of it:
// what it is, what it touches, exactly what would change, who decides and for
// how long. Two buttons, neither focused as the card appears, and no third
// way to answer. Once there is an outcome it takes the buttons' place in a
// status line, and the card stays as the record of what was decided.
export function ApprovalCard({
  model,
  words,
  onApprove,
  onRefuse,
}: {
  model: CardModel;
  words: PanelWords;
  onApprove: () => void;
  onRefuse: () => void;
}) {
  const titleId = useId();
  const open = model.status === 'pending';
  const busy = model.status === 'deciding';
  return (
    <section
      className={styles.card}
      aria-labelledby={titleId}
      data-approval-card
      data-status={model.status}
      tabIndex={-1}
    >
      <p className={styles.kicker}>{model.kicker}</p>
      <h4 id={titleId} className={styles.title}>
        {model.title}
      </h4>
      <dl className={styles.facts}>
        {model.tenant === null ? null : (
          <div className={styles.fact}>
            <dt>{words.cardTenant}</dt>
            <dd>
              <strong className={styles.tenant}>{model.tenant}</strong>{' '}
              <span className={styles.aside}>{model.tenantNote}</span>
            </dd>
          </div>
        )}
        <div className={styles.fact}>
          <dt>{words.cardTarget}</dt>
          <dd>
            <span className={styles.target}>
              <span>{model.targetType}</span>
              {model.targetName === null ? null : (
                <strong className={styles.name}>{model.targetName}</strong>
              )}
              {model.targetId === null ? null : (
                <CopyValue label={model.copyLabel} value={model.targetId} short />
              )}
            </span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{words.cardWho}</dt>
          <dd>
            {model.who}. <span className={styles.aside}>{words.cardWhoNote}</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{words.cardTime}</dt>
          <dd>
            <Countdown
              text={model.remaining}
              announcement={model.announcement}
              expired={model.status === 'expired'}
            />
          </dd>
        </div>
      </dl>
      {model.tierNote === null ? null : (
        <p className={styles.tier} data-tier={model.tier}>
          {model.tierNote}
        </p>
      )}
      {model.set === null ? null : <SetDiff set={model.set} label={words.cardChanges} />}
      <ChangeDiff rows={model.rows} creating={model.creating} words={words} />
      <Problem>{model.problem}</Problem>
      {open || busy ? (
        <div className={styles.actions}>
          <Button variant="primary" isDisabled={busy} onPress={onApprove}>
            {words.cardApprove}
          </Button>
          <Button variant="secondary" isDisabled={busy} onPress={onRefuse}>
            {words.cardRefuse}
          </Button>
        </div>
      ) : null}
      {open || busy ? <p className={styles.aside}>{words.cardRefuseNote}</p> : null}
      <p role="status" className={styles.outcome} data-status={model.status}>
        {open ? null : model.outcome}
      </p>
    </section>
  );
}
