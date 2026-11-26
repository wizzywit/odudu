const EVENT_END = '\n\n';

function isErrorEvent(event: string): boolean {
  const line = event.split('\n').find((candidate) => candidate.startsWith('data:'));
  if (line === undefined) return false;
  try {
    const part: unknown = JSON.parse(line.slice(5).trim());
    return typeof part === 'object' && part !== null && 'type' in part && part.type === 'error';
  } catch {
    return false;
  }
}

function isDone(event: string): boolean {
  return event.trim() === 'data: [DONE]';
}

// The chat client stops reading a stream the moment an error part arrives, so
// the part that says why the turn ended, which the server sends last, would
// never be read. This holds an error part back until the rest of the stream
// has been passed on, and sends it just before the end marker. Events are cut
// at a blank line, as the stream's own format has them.
export function deferStreamError(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let buffer = '';
  let held: string | null = null;
  let finished = false;

  function pass(events: string[]): Uint8Array {
    const out: string[] = [];
    for (const event of events) {
      if (isErrorEvent(event)) {
        held = event;
      } else if (isDone(event) && held !== null) {
        out.push(held, event);
        held = null;
      } else {
        out.push(event);
      }
    }
    return encoder.encode(out.map((event) => `${event}${EVENT_END}`).join(''));
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!finished) {
        const next = await reader.read();
        if (next.done) {
          finished = true;
          const rest = buffer.trim() === '' ? [] : [buffer];
          const tail = held === null ? [] : [held];
          held = null;
          controller.enqueue(pass(rest));
          controller.enqueue(encoder.encode(tail.map((event) => `${event}${EVENT_END}`).join('')));
          controller.close();
          return;
        }
        buffer += decoder.decode(next.value, { stream: true });
        const events = buffer.split(EVENT_END);
        buffer = events.pop() ?? '';
        const out = pass(events);
        if (out.length > 0) {
          controller.enqueue(out);
          return;
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
