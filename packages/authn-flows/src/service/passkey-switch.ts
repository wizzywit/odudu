// The relying party id a sign-in checks the person's passkeys against, or
// null where it checks nothing: the switch is off, or this deployment has no
// relying party, where the enrolment page cannot be shown and an action owed
// for it would turn the switch into a lockout. Only a passkey registered
// under the current id is one the sign-in offers, so only it counts.
export function passkeyCheckedAgainst(facts: {
  required: boolean;
  relyingPartyId: string | null;
}): string | null {
  return facts.required ? facts.relyingPartyId : null;
}
