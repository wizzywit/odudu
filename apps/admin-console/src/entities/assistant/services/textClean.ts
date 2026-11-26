// Controls other than tab and newline, the bidirectional overrides and
// isolates that reorder what a person reads, and zero-width characters.
function invisible(code: number): boolean {
  return (
    (code < 32 && code !== 9 && code !== 10) ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

// The text without a character that hides or reorders others. Markup is not
// touched: it is never interpreted, so it is shown as the text it is.
export function cleanText(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at += 1) {
    if (!invisible(text.charCodeAt(at))) out += text.charAt(at);
  }
  return out;
}

// Whether any such character is left, for a test to ask.
export function hasInvisible(text: string): boolean {
  return cleanText(text) !== text;
}
