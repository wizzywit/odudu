// Node 24 warns twice, at import, about WebCrypto surface this project never
// asks for directly: @simplewebauthn/server's settings singleton
// feature-detects post-quantum passkey support in its constructor
// (`subtle.supports('verify', 'ML-DSA-44')`), and Node flags both the
// `supports` method and the algorithm name as experimental. Both packages are
// on their latest stable release and the call has no opt-out, so there is no
// dependency to resolve. ADR 0025 has the diagnosis and the rejected fixes.
const SILENCED: readonly string[] = [
  'The supports Web Crypto API method is an experimental feature and might change at any time',
  'The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time',
];

// Whole message, not a substring: a warning about a different algorithm or a
// different experimental API is news, and a prefix match would bury it.
export function isKnownExperimentalWarning(warning: Error): boolean {
  return warning.name === 'ExperimentalWarning' && SILENCED.includes(warning.message);
}

// Node prints warnings from its own `onWarning` listener, so filtering means
// taking that listener off and calling it for everything else — which keeps
// Node's formatting for every warning this does not know about.
const inherited = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (isKnownExperimentalWarning(warning)) return;
  for (const listener of inherited) listener(warning);
});
