import { isValidProfileUrl } from '@odudu/contracts';

// profile, picture and website: the server takes only an http or https
// address, since a relying party renders each as a link.
export function urlProblem(value: string): string | null {
  if (value === '') return null;
  if (!isValidProfileUrl(value)) return 'Start it with https:// or http://.';
  try {
    const url = new URL(value);
    return url.hostname === '' ? 'This is not a complete address.' : null;
  } catch {
    return 'This is not a complete address.';
  }
}

// The console's content security policy loads images from its own origin
// alone (packages/console-gateway/src/view/spa.ts), so only such a picture
// can be shown rather than refused.
export function previewable(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}
