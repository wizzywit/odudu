// Runs `run` once after `ms`; the returned function cancels it.
export function schedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
}
