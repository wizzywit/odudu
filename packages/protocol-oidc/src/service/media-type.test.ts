import { describe, expect, it } from 'vitest';
import { carriesUnsupportedRepresentation, isFormEncoded } from '#/service/media-type';

const headers = (over: {
  contentType?: string;
  contentLength?: string;
  transferEncoding?: string;
}): Parameters<typeof carriesUnsupportedRepresentation>[0] => ({
  contentType: undefined,
  contentLength: undefined,
  transferEncoding: undefined,
  ...over,
});

describe('isFormEncoded', () => {
  it('accepts the bare media type', () => {
    expect(isFormEncoded('application/x-www-form-urlencoded')).toBe(true);
  });

  it('ignores parameters and case', () => {
    expect(isFormEncoded('APPLICATION/X-WWW-Form-Urlencoded; charset=UTF-8')).toBe(true);
  });

  it('refuses another media type', () => {
    expect(isFormEncoded('application/json')).toBe(false);
  });
});

describe('carriesUnsupportedRepresentation', () => {
  it('refuses a media type these endpoints cannot read', () => {
    expect(carriesUnsupportedRepresentation(headers({ contentType: 'application/json' }))).toBe(
      true,
    );
  });

  it('accepts a request naming no content type and carrying no body', () => {
    expect(carriesUnsupportedRepresentation(headers({}))).toBe(false);
  });

  it('refuses a body whose media type is unstated', () => {
    expect(carriesUnsupportedRepresentation(headers({ contentLength: '12' }))).toBe(true);
  });

  it('refuses a chunked body whose media type is unstated', () => {
    expect(carriesUnsupportedRepresentation(headers({ transferEncoding: 'chunked' }))).toBe(true);
  });

  // RFC 9110 §8.6 spells Content-Length as `1*DIGIT`, so `00` and `0` are one
  // length written two ways — and a bodiless POST is answered as a request
  // with no parameters, never as a representation to refuse.
  it.each(['0', '00', '000'])('reads Content-Length %s as no body at all', (contentLength) => {
    expect(carriesUnsupportedRepresentation(headers({ contentLength }))).toBe(false);
  });
});
