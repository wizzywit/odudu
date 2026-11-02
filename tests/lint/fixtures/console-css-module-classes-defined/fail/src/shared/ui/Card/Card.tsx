import styles from './Card.module.css';

export function Card({ tone }: { tone: string }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>x</h2>
      <p className={styles.action}>y</p>
      <p className={styles['separator']}>z</p>
      <p className={styles[tone]}>w</p>
    </section>
  );
}

export const all = styles;
