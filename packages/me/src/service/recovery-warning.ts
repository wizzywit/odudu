// Whether a person with `unspent` recovery codes left is below the tenant's
// threshold. A threshold of 0 is the tenant turning the warning off.
export function recoveryWarning(unspent: number, threshold: number): boolean {
  return unspent < threshold;
}

// A person who holds no set has nothing running low: being asked to issue
// one is a different matter from being warned about one.
export function recoveryCodesLow(read: {
  readonly held: number;
  readonly unspent: number;
  readonly threshold: number;
}): boolean {
  return read.held > 0 && recoveryWarning(read.unspent, read.threshold);
}
