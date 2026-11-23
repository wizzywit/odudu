export interface Budget {
  // False once the bytes passed would exceed the limit, and ever after.
  spend(bytes: number): boolean;
  exceeded(): boolean;
}

export function createBudget(limit: number): Budget {
  let spent = 0;
  let over = false;
  return {
    spend(bytes) {
      if (over) return false;
      spent += bytes;
      over = spent > limit;
      return !over;
    },
    exceeded: () => over,
  };
}

// Whether a Content-Length header already says the body is too large. A header
// that is absent or not a number says nothing; the count of bytes decides then.
export function declaresMoreThan(contentLength: string | null, limit: number): boolean {
  if (contentLength === null || !/^\d+$/u.test(contentLength)) return false;
  return Number(contentLength) > limit;
}
