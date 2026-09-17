const DAY_MS = 86_400_000;

// Whether a realm's `password_max_age_days` has run out on a stored
// password. A zero maximum is the feature switched off, the default for
// every realm — not "expires immediately". An expired password still
// authenticates: it is collected as the update-password required action,
// which blocks the login from completing rather than refusing the factor
// (see recordPasswordExpiryIfOwed in @odudu/authn-flows).
export function passwordExpired(
  credential: { createdAt: Date },
  maxAgeDays: number,
  now: Date,
): boolean {
  if (maxAgeDays <= 0) return false;
  const ageMs = now.getTime() - credential.createdAt.getTime();
  return ageMs >= maxAgeDays * DAY_MS;
}
