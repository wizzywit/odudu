const FENCE = /^ {0,3}```/u;

// A streamed answer, cut at the last block still being written. A block ends
// at a blank line outside a code fence; everything before the final one is
// settled and will not change as more text arrives, so a view can parse each
// settled block once and only the open one again per update.
export function splitBlocks(text: string): { settled: string[]; open: string } {
  const settled: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    const blank = !fenced && line.trim() === '';
    if (!blank) {
      current.push(line);
    } else if (current.length > 0) {
      settled.push(current.join('\n'));
      current = [];
    }
  }
  return { settled, open: current.join('\n') };
}
