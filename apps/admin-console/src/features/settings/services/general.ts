// Whether a save switches an enabled tenant off, from the values as read.
export function disablesTenant(was: unknown, now: unknown): boolean {
  return was === true && now !== true;
}
