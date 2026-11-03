// A number field cleared reads NaN; the value then stays as it was.
export function numberKept(entered: number, was: number): number {
  return Number.isNaN(entered) ? was : entered;
}

// The range a server holds a number to: each end shown by `show`, and `unit`
// after the last.
export function rangeSentence(
  min: number,
  max: number | undefined,
  show: (value: number) => string = String,
  unit = '',
): string {
  return max === undefined
    ? `At least ${show(min)}${unit}.`
    : `Between ${show(min)} and ${show(max)}${unit}.`;
}
