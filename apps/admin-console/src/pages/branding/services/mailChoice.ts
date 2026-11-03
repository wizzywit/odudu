import type { MailSchemeName } from '#/pages/branding/types/mailBranding';

export interface MailChoice {
  scheme: MailSchemeName;
  // Empty is the tenant's default language.
  locale: string;
  // The id of the client whose mail is shown; empty is the tenant's own.
  client: string;
}

export const DEFAULT_MAIL_CHOICE: MailChoice = { scheme: 'light', locale: '', client: '' };

export function mailChoiceWith(was: MailChoice, change: Partial<MailChoice>): MailChoice {
  return { ...was, ...change };
}

export interface MailClient {
  id: string;
  name: string;
}

// The client a picker's selection names, among the options it holds; the one
// chosen last, since a multiple-choice picker reports every id it holds.
export function mailClientOf(
  options: readonly MailClient[],
  ids: readonly string[],
): MailClient | null {
  const id = ids.at(-1);
  const found = options.find((option) => option.id === id);
  return found === undefined ? null : { id: found.id, name: found.name };
}

// What the choice of client means to the rest of the tab: the id the routes
// are asked with (empty is the tenant's own), the name the wording uses, and
// the ids the picker shows as selected.
export function mailClientId(client: MailClient | null): string {
  return client === null ? '' : client.id;
}

export function mailClientName(client: MailClient | null): string | null {
  return client === null ? null : client.name;
}

export function mailClientSelection(client: MailClient | null): string[] {
  return client === null ? [] : [client.id];
}

// A frame reloads when what it shows may have changed: the published version,
// or what is asked of it.
export function mailFrameKey(publishedVersion: number | undefined, choice: MailChoice): string {
  return `${String(publishedVersion ?? 0)}|${choice.scheme}|${choice.locale}|${choice.client}`;
}
