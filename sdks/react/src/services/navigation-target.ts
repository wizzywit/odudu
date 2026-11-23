// The address to hand to the browser, or undefined when it must not be
// followed. It is judged on the parsed address, which is what the browser
// follows: the parser drops tabs and newlines and lowercases the scheme, so
// `java\tscript:` and `JaVaScRiPt:` parse as `javascript:`. A protocol-relative
// address resolves to the page's own scheme and is accepted when that is
// http or https.
export function safeNavigationTarget(target: string, base: string): string | undefined {
  try {
    const { protocol } = new URL(target, base);
    return protocol === 'http:' || protocol === 'https:' ? target : undefined;
  } catch {
    return undefined;
  }
}
