import styles from '#/shared/view/Count.module.css';

const NUMBER = new Intl.NumberFormat('en');

// The API counts no further than its cap, so a capped count is a floor.
export function Count({
  count,
  capped,
  noun,
}: {
  count: number;
  capped: boolean;
  noun: { one: string; other: string };
}) {
  const figure = `${NUMBER.format(count)}${capped ? '+' : ''}`;
  const word = count === 1 && !capped ? noun.one : noun.other;
  return <span className={styles.count}>{`${figure} ${word}`}</span>;
}
