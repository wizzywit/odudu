const MAX_PROBLEM_BYTES = 64 * 1024;

type Chunk = { done: true; value?: undefined } | { done: false; value: Uint8Array };

/** The body as text, or undefined when it is longer than a problem document ever is. */
export async function readProblemText(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = (await reader.read()) as Chunk;
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_PROBLEM_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}
