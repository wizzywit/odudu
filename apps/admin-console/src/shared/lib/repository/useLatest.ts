import { useEffect, useRef, useState } from 'react';

// Reads what the latest render held, for a getter registered elsewhere and
// called after the render that made it. The getter itself never changes.
export function useLatest<T>(value: T): () => T {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const [read] = useState(() => () => latest.current);
  return read;
}
