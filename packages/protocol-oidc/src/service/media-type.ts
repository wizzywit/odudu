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

// Whether a request carries a representation these endpoints cannot read,
// answered with 415 (RFC 9110 §15.5.16) before any parser runs. A request
// naming no content type and carrying no body carries no representation to
// refuse: it is a request with no parameters, answered as one. A body with
// no content type has an unknown media type (RFC 9110 §8.3), and unknown is
// unsupported here — letting it fall through to the framework's own error
// puts back what this check removes: one refusal in two representations,
// depending on which parameter was missing.
export function carriesUnsupportedRepresentation(headers: {
  contentType: string | undefined;
  contentLength: string | undefined;
  transferEncoding: string | undefined;
}): boolean {
  if (headers.contentType !== undefined) return !isFormEncoded(headers.contentType);
  return (
    (headers.contentLength !== undefined && !statesAnEmptyBody(headers.contentLength)) ||
    headers.transferEncoding !== undefined
  );
}

// RFC 9110 §8.6 spells Content-Length as `1*DIGIT`, so `0` and `00` are one
// length written two ways. Comparing the raw field value against `'0'` would
// answer a bodiless POST with 415 for the sake of a leading zero.
function statesAnEmptyBody(contentLength: string): boolean {
  return /^0+$/u.test(contentLength.trim());
}
