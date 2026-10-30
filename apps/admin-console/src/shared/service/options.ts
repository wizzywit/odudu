// The longest detail an option draws beside its label. Narrowing reads the
// whole detail, so a word past this is still found.
export const OPTION_DETAIL_LIMIT = 90;

interface Narrowable {
  label: string;
  detail?: string | undefined;
}

// At most `limit` of the options that hold the typed text in their label or
// detail, those whose label starts with it first, otherwise in the order
// given. One pass over the options, so a list drawn from it is bounded
// however long the options are.
export function narrowOptions<T extends Narrowable>(
  options: readonly T[],
  text: string,
  limit: number,
): T[] {
  const typed = text.trim().toLowerCase();
  if (limit <= 0) return [];
  if (typed === '') return options.slice(0, limit);
  const starting: T[] = [];
  const containing: T[] = [];
  for (const option of options) {
    if (starting.length >= limit) break;
    const label = option.label.toLowerCase();
    if (label.startsWith(typed)) starting.push(option);
    else if (
      containing.length < limit &&
      `${label} ${option.detail ?? ''}`.toLowerCase().includes(typed)
    ) {
      containing.push(option);
    }
  }
  return [...starting, ...containing].slice(0, limit);
}
