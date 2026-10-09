import { useEffect, useState } from 'react';

// The current time, read again every `intervalMs`, so a relative time
// moves on while nothing else re-renders.
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
