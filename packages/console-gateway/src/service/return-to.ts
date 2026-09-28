import { UNSAFE_RETURN_TO } from '@odudu/contracts';

const PREFIX = '/console/';
const BASE = 'https://console.invalid';

export function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value === '' || UNSAFE_RETURN_TO.test(value)) return PREFIX;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return PREFIX;
  }

  if (url.origin !== BASE || !url.pathname.startsWith(PREFIX)) return PREFIX;

  return url.pathname + url.search + url.hash;
}
