// Whether a sign-in made at `authTime` is recent enough: a sign-in exactly
// `windowSeconds` old still counts.
export function isFresh(authTime: Date, now: Date, windowSeconds: number): boolean {
  return now.getTime() - authTime.getTime() <= windowSeconds * 1000;
}

// The WWW-Authenticate value that asks the application to send the person
// through a new sign-in no older than `windowSeconds` (RFC 9470 §3), and into
// one that earned the authentication context `acrValues` when it is named.
export function freshnessChallenge(windowSeconds: number, acrValues: string | null): string {
  const base =
    'Bearer error="insufficient_user_authentication", ' +
    `error_description="A recent sign-in is required", max_age="${String(windowSeconds)}"`;
  return acrValues === null ? base : `${base}, acr_values="${acrValues}"`;
}
