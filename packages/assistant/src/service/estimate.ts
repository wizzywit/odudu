const encoder = new TextEncoder();

// A ceiling on the input tokens a request can cost: no provider measured
// charged more than one token per serialised byte, so the byte length bounds
// it, and a count the provider reports can only raise it.
export function inputUpperBound(serialised: string, providerCount?: number): number {
  const bytes = encoder.encode(serialised).byteLength;
  const reported =
    providerCount !== undefined && Number.isFinite(providerCount) && providerCount > 0
      ? Math.ceil(providerCount)
      : 0;
  return Math.max(reported, bytes);
}
