import styles from './Card.module.css';

export function Card({ open }: { open: boolean }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>x</h2>
      <button className={styles.primary}>y</button>
      <div className={open ? styles['is-open'] : undefined} />
    </section>
  );
}
