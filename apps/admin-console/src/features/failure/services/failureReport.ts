export interface FailureReport {
  id: string;
  route: string;
  time: string;
}

// No I, L, O or U, so an id read aloud or copied by eye is not mistaken; 32
// characters, so a byte's low five bits pick one with no bias.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const FAILURE_ID_LENGTH = 8;

export function failureIdFrom(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, FAILURE_ID_LENGTH), (byte) =>
    ALPHABET.charAt(byte & 31),
  ).join('');
}

export function buildFailureReport({
  bytes,
  route,
  now,
}: {
  bytes: Uint8Array;
  route: string;
  now: Date;
}): FailureReport {
  return { id: failureIdFrom(bytes), route, time: now.toISOString() };
}

// What a person may copy into a message to support: the id, the page as a
// template, the time. No message, no stack, no address, nothing about them.
export function failureDetails(report: FailureReport): string {
  return [`Error ID: ${report.id}`, `Page: ${report.route}`, `Time: ${report.time}`].join('\n');
}

// Only a development build shows what the error said; a production page
// carries the id alone and the full error goes to the console beside it.
export function shownMessage(error: unknown, development: boolean): string | null {
  if (!development) return null;
  const text = error instanceof Error ? error.message : error;
  return typeof text === 'string' && text !== '' ? text : null;
}
