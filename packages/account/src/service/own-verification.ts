export interface OwnVerificationFacts {
  readonly verified: boolean;
  readonly hasEmail: boolean;
  // Whether the deployment can send mail for this tenant at all.
  readonly mailAvailable: boolean;
}

export type OwnVerificationVerdict = 'send' | 'verified' | 'unavailable' | 'limited';

// What a person asking for a link to their own address is told. `budgetAllows`
// uses up one mail of the address's budget when it answers true, so it is
// asked only once everything else has agreed that a mail would go out.
export function ownVerificationVerdict(
  facts: OwnVerificationFacts,
  budgetAllows: () => boolean,
): OwnVerificationVerdict {
  if (facts.verified) return 'verified';
  if (!facts.hasEmail || !facts.mailAvailable) return 'unavailable';
  return budgetAllows() ? 'send' : 'limited';
}
