// A private window or blocked site data refuses storage, sometimes at the
// getter itself; every caller treats undefined as "nothing is kept".
export function browserStorage(kind: 'local' | 'session'): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}
