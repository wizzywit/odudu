import { describe, expect, it } from 'vitest';
import { isKnownExperimentalWarning } from './runtime-warnings.js';

function warning(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const SUPPORTS =
  'The supports Web Crypto API method is an experimental feature and might change at any time';
const ML_DSA =
  'The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time';

describe('the two warnings @simplewebauthn/server provokes at import', () => {
  it('recognises both of them', () => {
    expect(isKnownExperimentalWarning(warning('ExperimentalWarning', SUPPORTS))).toBe(true);
    expect(isKnownExperimentalWarning(warning('ExperimentalWarning', ML_DSA))).toBe(true);
  });

  // The point of matching the whole message rather than a substring: a
  // runtime that starts warning about a different algorithm, or a different
  // experimental API, is news.
  it('does not recognise a warning about another algorithm or another API', () => {
    expect(
      isKnownExperimentalWarning(
        warning('ExperimentalWarning', ML_DSA.replace('ML-DSA-44', 'ML-DSA-87')),
      ),
    ).toBe(false);
    expect(
      isKnownExperimentalWarning(
        warning('ExperimentalWarning', 'The Foo Web Crypto API method is an experimental feature'),
      ),
    ).toBe(false);
  });

  it('does not recognise a non-experimental warning carrying the same text', () => {
    expect(isKnownExperimentalWarning(warning('DeprecationWarning', ML_DSA))).toBe(false);
  });
});
