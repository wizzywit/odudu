import type { StepEvent } from '#/widgets/assistant-panel/services/stepTimes';

const EVENT_END = '\n\n';

const KINDS: Readonly<Record<string, StepEvent['kind']>> = {
  'tool-input-start': 'begin',
  'tool-output-available': 'end',
  'tool-output-error': 'end',
  'tool-approval-request': 'waits',
};

function stepOf(event: string, at: number): StepEvent | null {
  const line = event.split('\n').find((candidate) => candidate.startsWith('data:'));
  if (line === undefined) return null;
  try {
    const part: unknown = JSON.parse(line.slice(5).trim());
    if (typeof part !== 'object' || part === null) return null;
    const type = 'type' in part && typeof part.type === 'string' ? part.type : '';
    const id = 'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : '';
    const kind = KINDS[type];
    return kind === undefined || id === '' ? null : { id, kind, at };
  } catch {
    return null;
  }
}

// Passes a stream on untouched, and says when each tool call began and ended
// as it goes by, so a step can show how long it took without the page timing
// its own redraws.
export function watchSteps(
  body: ReadableStream<Uint8Array>,
  onStep: (step: StepEvent) => void,
  now: () => number = Date.now,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(EVENT_END);
        buffer = events.pop() ?? '';
        const at = now();
        for (const event of events) {
          const step = stepOf(event, at);
          if (step !== null) onStep(step);
        }
      },
    }),
  );
}
