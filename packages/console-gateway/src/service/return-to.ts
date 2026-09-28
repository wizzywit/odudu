const PREFIX = '/console/';
const BASE = 'https://console.invalid';

// A raw C0 control character or backslash, or a percent-encoded C0
// control (%00-%1F, %7F) or percent-encoded percent sign (%25): each is
// a way a downstream decoder — a proxy, a log line, a second `new URL`
// call — could turn this value into something that escapes /console/ or
// injects a header, even though the WHATWG parser below leaves it inert.
const UNSAFE_RAW = /[\x00-\x1f\x7f\\]|%(?:25|0[0-9a-f]|1[0-9a-f]|7f)/i;

export function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value === '' || UNSAFE_RAW.test(value)) return PREFIX;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return PREFIX;
  }

  if (url.origin !== BASE || !url.pathname.startsWith(PREFIX)) return PREFIX;

  return url.pathname + url.search + url.hash;
}
