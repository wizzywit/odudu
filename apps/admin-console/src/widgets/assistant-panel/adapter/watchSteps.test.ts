import { expect, it } from 'vitest';
import { watchSteps } from '#/widgets/assistant-panel/adapter/watchSteps';
import type { StepEvent } from '#/widgets/assistant-panel/services/stepTimes';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const event = (part: unknown): string => `data: ${JSON.stringify(part)}\n\n`;

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

it('passes the stream on as it was and says when each tool call began, ended or stopped to wait', async () => {
  const steps: StepEvent[] = [];
  const text =
    event({ type: 'tool-input-start', toolCallId: 'a', toolName: 'list_roles' }) +
    event({ type: 'text-delta', id: 't', delta: 'x' }) +
    event({ type: 'tool-output-available', toolCallId: 'a', output: {} }) +
    event({ type: 'tool-approval-request', toolCallId: 'b', approvalId: 'x' }) +
    'data: [DONE]\n\n';
  let time = 100;
  const passed = watchSteps(
    streamOf(text),
    (step) => steps.push(step),
    () => (time += 100),
  );
  expect(await drain(passed)).toBe(text);
  expect(steps).toEqual([
    { id: 'a', kind: 'begin', at: 200 },
    { id: 'a', kind: 'end', at: 200 },
    { id: 'b', kind: 'waits', at: 200 },
  ]);
});

it('reads an event that arrives in two pieces once, and ignores what it does not know', async () => {
  const steps: StepEvent[] = [];
  const whole = event({ type: 'tool-output-error', toolCallId: 'c', errorText: 'boom' });
  const passed = watchSteps(
    streamOf(whole.slice(0, 20), whole.slice(20), 'data: not json\n\n', ': comment\n\n'),
    (step) => steps.push(step),
    () => 5,
  );
  await drain(passed);
  expect(steps).toEqual([{ id: 'c', kind: 'end', at: 5 }]);
});
