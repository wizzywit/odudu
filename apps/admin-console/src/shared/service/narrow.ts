// The width, in rem, under which an editor beside a preview is stacked above
// it: the preview becomes a strip, a code field can wrap, and folds appear.
// The container queries in the stylesheets say the same number, which a
// custom property cannot feed; `tests/lint/console-breakpoints.test.ts` holds
// them to this one.
export const NARROW_REM = 48;

// Whether a container of `width` pixels is narrow, at `rem` pixels to the rem.
export function isNarrow(width: number, rem: number): boolean {
  return rem > 0 && width / rem < NARROW_REM;
}
