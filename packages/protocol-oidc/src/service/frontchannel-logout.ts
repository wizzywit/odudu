// Front-Channel Logout 1.0 §3. `iss` always; `sid` only where the client
// registered `frontchannel_logout_session_required`. Built with `URL` so a
// query component the client registered survives rather than being
// replaced — `URLSearchParams.set` adds to what a parsed URL already
// carries, it does not start the query string over.
export function frontChannelLogoutUrl(
  registered: string,
  issuer: string,
  sessionId: string,
  sessionRequired: boolean,
): string {
  const url = new URL(registered);
  url.searchParams.set('iss', issuer);
  if (sessionRequired) url.searchParams.set('sid', sessionId);
  return url.toString();
}
