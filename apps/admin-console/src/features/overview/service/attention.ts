import type { CountResponse, Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { readyToPromote } from '#/shared/service/keyPromotion.ts';

export interface AttentionItem {
  id: string;
  // The area whose page fixes it.
  area: 'email' | 'keys' | 'settings';
  title: string;
  detail: string;
}

// A read that is undefined was not made or not answered, and the checks
// that need it are skipped rather than guessed.
export interface AttentionInputs {
  settings: Settings | undefined;
  smtp: SmtpConfig | undefined;
  keys: readonly SigningKey[] | undefined;
  clients: CountResponse | undefined;
  now: Date;
}

function mailNeeds(settings: Settings): string | null {
  const needs = [
    settings.verify_email === true ? 'email verification' : null,
    settings.reset_password_allowed === true ? 'password reset' : null,
  ].filter((need) => need !== null);
  return needs.length === 0 ? null : needs.join(' and ');
}

function mail(settings: Settings | undefined, smtp: SmtpConfig | undefined): AttentionItem[] {
  if (settings === undefined || smtp?.effective !== 'none') return [];
  const needs = mailNeeds(settings);
  if (needs === null) return [];
  return [
    {
      id: 'smtp',
      area: 'email',
      title: 'No mail relay',
      detail: `This tenant has ${needs} on, but neither it nor the deployment has an SMTP relay, so that mail is only logged.`,
    },
  ];
}

function promotions(keys: readonly SigningKey[] | undefined, now: Date): AttentionItem[] {
  return (keys === undefined ? [] : readyToPromote(keys, now)).map((key) => ({
    id: `key:${key.id}`,
    area: 'keys',
    title: 'A signing key is ready to promote',
    detail: `The ${key.alg} key ${key.kid} has been published longer than any token lives, so relying parties can verify what it signs.`,
  }));
}

// A capped count is a floor: it decides "full" only when the cap is at or
// below the count it stopped at.
function registration(
  settings: Settings | undefined,
  clients: CountResponse | undefined,
): AttentionItem[] {
  if (settings === undefined || clients === undefined) return [];
  const policy = settings.client_registration_policy;
  const cap = settings.max_clients;
  if ((policy !== 'open' && policy !== 'token') || typeof cap !== 'number') return [];
  if (clients.count < cap) return [];
  const how = policy === 'open' ? 'open to anyone' : 'open with a registration token';
  return [
    {
      id: 'registration',
      area: 'settings',
      title: 'Dynamic registration has no room left',
      detail: `Registration is ${how}, but the tenant already holds its limit of ${String(cap)} clients, so every registration is refused.`,
    },
  ];
}

export function needsAttention(inputs: AttentionInputs): readonly AttentionItem[] {
  return [
    ...mail(inputs.settings, inputs.smtp),
    ...promotions(inputs.keys, inputs.now),
    ...registration(inputs.settings, inputs.clients),
  ];
}
