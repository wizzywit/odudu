import { describe, expect, it } from 'vitest';
import { deferStreamError } from '#/widgets/assistant-panel/adapter/deferError';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) return text;
    text += decoder.decode(next.value, { stream: true });
  }
}

const START = 'data: {"type":"start"}\n\n';
const ERROR = 'data: {"type":"error","errorText":"The allowance is used."}\n\n';
const END =
  'data: {"type":"data-turn_end","data":{"stopReason":"budget_turn"},"transient":true}\n\n';
const DONE = 'data: [DONE]\n\n';

describe('an error part held until the turn’s last part has been passed on', () => {
  it('sends the error after the turn end and before the end marker', async () => {
    const out = await readAll(deferStreamError(streamOf(START, ERROR, END, DONE)));
    expect(out).toBe(START + END + ERROR + DONE);
  });

  it('finds an event however the network cut it', async () => {
    const whole = START + ERROR + END + DONE;
    const cut = [whole.slice(0, 13), whole.slice(13, 60), whole.slice(60, 111), whole.slice(111)];
    expect(await readAll(deferStreamError(streamOf(...cut)))).toBe(START + END + ERROR + DONE);
  });

  it('leaves a stream with no error exactly as it was', async () => {
    const plain = START + END + DONE;
    expect(await readAll(deferStreamError(streamOf(plain)))).toBe(plain);
  });

  it('sends a held error at the end when the stream has no end marker', async () => {
    expect(await readAll(deferStreamError(streamOf(START, ERROR, END)))).toBe(START + END + ERROR);
  });

  it('does not take a text part that mentions an error for one', async () => {
    const text = 'data: {"type":"text-delta","delta":"\\"type\\":\\"error\\""}\n\n';
    expect(await readAll(deferStreamError(streamOf(text, DONE)))).toBe(text + DONE);
  });

  it('passes a multi-byte character cut between chunks whole', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"type":"text-delta","delta":"é"}\n\n');
    const at = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, at));
        controller.enqueue(bytes.slice(at));
        controller.close();
      },
    });
    expect(await readAll(deferStreamError(body))).toBe(
      'data: {"type":"text-delta","delta":"é"}\n\n',
    );
  });
});
