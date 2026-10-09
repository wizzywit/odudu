// A raw C0 control character, DEL or backslash, or a percent-encoded C0
// control (%00-%1F, %7F) or percent sign (%25): each is a way a downstream
// decoder — a proxy, a log line, a second `new URL` call — could turn a
// console return path into something that escapes /console/ or injects a
// header, even where the WHATWG parser leaves it inert. The gateway refuses
// such a return_to, and the console never sends one.
export const UNSAFE_RETURN_TO = /[\x00-\x1f\x7f\\]|%(?:25|0[0-9a-f]|1[0-9a-f]|7f)/i;
