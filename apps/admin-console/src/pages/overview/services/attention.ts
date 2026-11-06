import type { SmtpConfig } from '#/entities/mail-relay';
import type { SigningKey } from '#/entities/signing-key';
import type { Settings } from '#/entities/tenant';
import type { CountResponse } from '#/shared/lib/types/count';
import type { EntityRules } from '#/pages/overview/services/entityRules';

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
  rules: EntityRules;
}

function mailNeeds(settings: Settings): string | null {
  const needs = [
    settings.verify_email === true ? 'email verification' : null,
    settings.reset_password_allowed === true ? 'password reset' : null,
  ].filter((need) => need !== null);
  return needs.length === 0 ? null : needs.join(' and ');
}

function mail(
  settings: Settings | undefined,
  smtp: SmtpConfig | undefined,
  rules: EntityRules,
): AttentionItem[] {
  if (settings === undefined || smtp === undefined || rules.hasRelay(smtp)) return [];
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

function promotions(
  keys: readonly SigningKey[] | undefined,
  now: Date,
  rules: EntityRules,
): AttentionItem[] {
  return (keys === undefined ? [] : rules.readyToPromote(keys, now)).map((key) => ({
    id: `key:${key.id}`,
    area: 'keys',
    title: 'A signing key is ready to promote',
    detail: `The ${key.alg} key ${key.kid} has been published longer than any token lives, so relying parties can verify what it signs.`,
  }));
}

// A capped count is a floor: it decides "full" only when the cap is at or
// below the count it stopped at. Open registration is not here: clients that
// register themselves have a limit of their own, which max_clients does not set.
function registration(
  settings: Settings | undefined,
  clients: CountResponse | undefined,
): AttentionItem[] {
  if (settings === undefined || clients === undefined) return [];
  const policy = settings.client_registration_policy;
  const cap = settings.max_clients;
  if (policy !== 'token' || typeof cap !== 'number') return [];
  if (clients.count < cap) return [];
  return [
    {
      id: 'registration',
      area: 'settings',
      title: 'Registration by token has no room left',
      detail: `Registration is open with a registration token, but the tenant already holds its limit of ${String(cap)} clients, so every registration is refused.`,
    },
  ];
}

export function needsAttention(inputs: AttentionInputs): readonly AttentionItem[] {
  return [
    ...mail(inputs.settings, inputs.smtp, inputs.rules),
    ...promotions(inputs.keys, inputs.now, inputs.rules),
    ...registration(inputs.settings, inputs.clients),
  ];
}
