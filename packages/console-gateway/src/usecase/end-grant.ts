import { type OduduPort } from '#/service/odudu-port';

// Best effort: the caller has already let go of the session or sign-in
// these tokens belonged to, and answers the same whether or not this lands.
export async function endGrant(
  odudu: OduduPort,
  tenant: string,
  refreshToken: string,
  ip: string,
): Promise<void> {
  try {
    await odudu.revoke(tenant, refreshToken, ip);
  } catch {
    // Nothing is answered differently for a revoke that failed.
  }
}
