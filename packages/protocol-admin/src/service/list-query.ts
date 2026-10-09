const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

// The smallest string, in code-point order, greater than every string that
// starts with `folded` — the exclusive upper bound of a prefix range over a
// `COLLATE "C"` column, whose UTF-8 byte order is code-point order. `null`
// when no such string exists, so the range is open above.
export function prefixUpperBound(folded: string): string | null {
  const codePoints = Array.from(folded, (char) => char.codePointAt(0) ?? 0);
  while (codePoints.length > 0 && codePoints[codePoints.length - 1] === MAX_CODE_POINT) {
    codePoints.pop();
  }
  const last = codePoints.pop();
  if (last === undefined) return null;
  const next = last + 1 === SURROGATE_FIRST ? SURROGATE_LAST + 1 : last + 1;
  return String.fromCodePoint(...codePoints, next);
}
