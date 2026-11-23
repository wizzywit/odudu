export type ProxyFailure =
  | 'too-large'
  | 'answer-too-large'
  | 'timeout'
  | 'failed'
  // The session's grant does not carry the audience the upstream needs.
  | 'not-granted';

const ANSWERS: Record<ProxyFailure, { status: number; message: string }> = {
  'too-large': { status: 413, message: 'The body is too large.' },
  'answer-too-large': { status: 502, message: 'The upstream answer is too large.' },
  timeout: { status: 504, message: 'The upstream did not answer in time.' },
  failed: { status: 502, message: 'The upstream could not be reached.' },
  'not-granted': { status: 502, message: 'The upstream could not be called for this session.' },
};

// What the browser is told when the proxy cannot give it the upstream's answer.
export function answerFor(failure: ProxyFailure): { status: number; message: string } {
  return ANSWERS[failure];
}
