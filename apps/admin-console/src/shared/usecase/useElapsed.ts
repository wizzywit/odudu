import { useEffect, useState } from 'react';

// Whether `ms` have passed since mount, so a placeholder can stay unseen
// for a read that finishes first.
export function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setElapsed(true);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [ms]);
  return elapsed;
}
