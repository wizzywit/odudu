import { signAssertion, type AssertionKey } from '#/adapter/client-assertion';

export function signClientAssertionFor(
  signing: AssertionKey,
  clientId: string,
  tokenEndpoint: string,
  nowSeconds: number,
): Promise<string> {
  return signAssertion(signing, clientId, tokenEndpoint, nowSeconds);
}
