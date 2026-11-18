// Whether a password-reset request mails the address it found. A tenant that
// asks for proof of an address (verify_email) sends reset links only to a
// verified one; a tenant that does not accepts unproved addresses.
export function resetTarget(input: {
  readonly verified: boolean;
  readonly requireVerified: boolean;
}): 'send' | 'skip' {
  return input.requireVerified && !input.verified ? 'skip' : 'send';
}
