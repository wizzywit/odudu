export interface Headed {
  group?: string;
}

// Neighbouring options under one heading, in the order offered; options with no
// group make one untitled run.
export function headedRuns<T extends Headed>(
  options: readonly T[],
): readonly { title: string | undefined; options: readonly T[] }[] {
  const runs: { title: string | undefined; options: T[] }[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last !== undefined && last.title === option.group) last.options.push(option);
    else runs.push({ title: option.group, options: [option] });
  }
  return runs;
}

// Short rows with no text of their own sit side by side; any that carries
// text keeps a row to itself.
export function isCompact(
  options: readonly { description?: string; note?: string | null; unavailable?: string | null }[],
): boolean {
  return options.every(
    (option) =>
      (option.description ?? '') === '' &&
      (option.note ?? '') === '' &&
      (option.unavailable ?? '') === '',
  );
}
