export interface LineIssue {
  // 1-based.
  line: number;
  text: string;
}

export interface GutterPart {
  text: string;
  marked: boolean;
}

// The marked lines that exist in a text of `count` lines, each once, in order.
export function markedLines(issues: readonly LineIssue[], count: number): number[] {
  const lines = new Set(
    issues.map((issue) => issue.line).filter((line) => line >= 1 && line <= count),
  );
  return [...lines].sort((a, b) => a - b);
}

// The line numbers as text runs, a marked line standing alone so a view can
// give it a mark. Joined, the parts are the numbers one to a line.
export function gutterParts(count: number, marked: readonly number[]): GutterPart[] {
  const set = new Set(marked);
  const parts: GutterPart[] = [];
  let run = '';
  for (let line = 1; line <= count; line += 1) {
    const separator = line === 1 ? '' : '\n';
    if (set.has(line)) {
      if (run + separator !== '') parts.push({ text: run + separator, marked: false });
      run = '';
      parts.push({ text: String(line), marked: true });
    } else {
      run += separator + String(line);
    }
  }
  if (run !== '') parts.push({ text: run, marked: false });
  return parts;
}

export function lineLabel(issue: LineIssue): string {
  return `Line ${String(issue.line)}: ${issue.text}`;
}
