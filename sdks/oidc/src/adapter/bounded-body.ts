type Chunk = { done: true; value?: undefined } | { done: false; value: Uint8Array };

// An OAuth error body is a few hundred bytes.
export const ERROR_BODY_LIMIT = 8192;

// The body as UTF-8 text, or undefined when it is longer than `limit` bytes,
// is not valid UTF-8, was read already or cannot be read. A declared length
// over the limit is refused unread; otherwise the stream is cancelled the
// moment the bytes counted pass the limit, so a server that never stops
// sending costs at most the limit.
export async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string | undefined> {
  try {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      return undefined;
    }
    if (response.bodyUsed) return undefined;
    const reader = response.body?.getReader();
    if (reader === undefined) return '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let size = 0;
    for (;;) {
      const { done, value } = (await reader.read()) as Chunk;
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  }
}
