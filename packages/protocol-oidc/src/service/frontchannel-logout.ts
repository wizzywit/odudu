// Front-Channel Logout 1.0 §3. `iss` always; `sid` only where the client
// registered `frontchannel_logout_session_required`. Built with `URL` so a
// query component the client registered survives rather than being
// replaced — `URLSearchParams.set` adds to what a parsed URL already
// carries, it does not start the query string over. `null` on a value
// `URL` cannot parse: registration validates this (`isValidLogoutUri`),
// but a row written around that check must not take logout down for the
// rest of the tenant.
export function frontChannelLogoutUrl(
  registered: string,
  issuer: string,
  sessionId: string,
  sessionRequired: boolean,
): string | null {
  let url: URL;
  try {
    url = new URL(registered);
  } catch {
    return null;
  }
  url.searchParams.set('iss', issuer);
  if (sessionRequired) url.searchParams.set('sid', sessionId);
  return url.toString();
}
