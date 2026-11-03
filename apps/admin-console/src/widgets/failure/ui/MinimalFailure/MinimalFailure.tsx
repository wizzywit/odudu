import { type FailureReport } from '#/widgets/failure/services/failureReport';
import { useMinimalFailure } from '#/widgets/failure/use-cases/useMinimalFailure';
import { buttonClass } from '#/shared/ui/Button';
import styles from '#/widgets/failure/ui/MinimalFailure/MinimalFailure.module.css';

// What is left when the failure screen itself failed: a heading, a sentence, the
// id the first failure was logged under and a link to the same address, which
// loads it again. Nothing here can fail but a string and an anchor.
export function MinimalFailure({ report }: { report: FailureReport | null }) {
  const view = useMinimalFailure(report);
  return (
    <main className={styles.minimal}>
      <h1>{view.title}</h1>
      <p>{view.text}</p>
      {view.idLine === null ? null : <p>{view.idLine}</p>}
      <a className={buttonClass} data-variant="primary" href={window.location.href}>
        {view.reload}
      </a>
    </main>
  );
}
