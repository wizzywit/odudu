// The built stylesheet is tokens, fonts and page rules joined in that order,
// so a build from other sources than these shows in its two ends. Pictures
// taken from a stale one would still pass the hash of the sources.
export function staleParts(
  built: string,
  sources: { tokensCss: string; pagesCss: string },
): string[] {
  const stale: string[] = [];
  if (!built.startsWith(sources.tokensCss)) stale.push('tokens.css');
  if (!built.endsWith(sources.pagesCss)) stale.push('pages.css');
  return stale;
}
