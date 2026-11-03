export const HOLDINGS_REQUIRED = 'Choose Full, or at least one capability.';

export function holdingsProblem(holdings: readonly string[]): string | null {
  return holdings.length === 0 ? HOLDINGS_REQUIRED : null;
}
