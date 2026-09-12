export const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';

// Every POST Odudu takes carries its parameters form serialized — the
// authorization request (OIDC Core §3.1.2.1), the token request (RFC 6749
// §3.2), the UserInfo request's body method (RFC 6750 §2.2). One reading of
// the header for all of them: the media type is what matters, and the
// parameters after it (charset above all) are not part of the comparison.
export function isFormEncoded(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [mediaType] = contentType.split(';');
  return mediaType?.trim().toLowerCase() === FORM_MEDIA_TYPE;
}
