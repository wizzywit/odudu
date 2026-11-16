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
    ? `Allowed: at least ${show(min)}${unit}.`
    : `Allowed: ${show(min)} to ${show(max)}${unit}.`;
}

// Whether a number is outside the range; one not entered is not.
export function outsideRange(
  value: number,
  min: number | undefined,
  max: number | undefined,
): boolean {
  return (
    Number.isFinite(value) &&
    ((min !== undefined && value < min) || (max !== undefined && value > max))
  );
}
