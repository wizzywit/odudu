import styles from '#/shared/ui/Count/Count.module.css';
import { groupedNumber } from '#/shared/lib/services/format';

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
  const figure = `${groupedNumber(count)}${capped ? '+' : ''}`;
  const word = count === 1 && !capped ? noun.one : noun.other;
  return <span className={styles.count}>{`${figure} ${word}`}</span>;
}
