import { writeRefusal } from '#/shared/services/capabilities';
import { writeFailureText } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';

const GUARDED = 'openid';

// The server refuses to delete it and says why; the console never offers the
// delete, so the refusal is never the first the caller hears of it.
export function isGuarded(name: string): boolean {
  return name === GUARDED;
}

// Why the delete is not offered, or null for a scope that can be deleted.
export function guardedText(name: string): string | null {
  return isGuarded(name) ? GUARDED_TEXT : null;
}

export const GUARDED_TEXT =
  'openid cannot be deleted. Deleting it takes it off every client, the built-in admin client included, and could lock out every administrator of this tenant.';

export function scopeDeleteConsequence(name: string): string {
  return `Deleting ${name} takes it off every client assigned ${name} and unmaps every role mapped to it. It cannot be undone.`;
}

export function scopeDeleteFailureText(name: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name,
    verb: 'deleted',
    lookAt: 'the scopes list',
    missing: `${name} was already gone.`,
    refused: (problem) => writeRefusal(problem),
  });
}
