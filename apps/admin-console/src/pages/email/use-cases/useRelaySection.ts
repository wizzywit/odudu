import type { SmtpConfig } from '@odudu/contracts/admin';
import { useRefusal } from '#/entities/session';
import { smtpSave } from '#/pages/email/repository/smtpSave';
import { SMTP_RECORD } from '#/pages/email/repository/useSmtpRecord';
import {
  passwordHint,
  RELAY_LABELS,
  relayHold,
  relayValues,
  type RelayValues,
} from '#/pages/email/services/relay';
import { EMAIL_WORDS, RELAY_TITLE, type EmailWords } from '#/pages/email/services/emailWords';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';

export interface RelaySection {
  words: EmailWords['relay'];
  save: SectionSave<RelayValues>;
  // Why Save is held, whether by the form or by a conflict.
  blocked: string | undefined;
  passwordNote: string;
  // Removing the stored password and typing a new one exclude each other.
  removePassword: (remove: boolean) => void;
}

export function useRelaySection({
  tenant,
  config,
  etag,
  gone,
}: {
  tenant: string;
  config: SmtpConfig;
  etag: string;
  gone: boolean;
}): RelaySection {
  const refusal = useRefusal(tenant);
  const now = relayValues(config);
  const save = useSectionSave({
    tenant,
    record: SMTP_RECORD,
    section: 'relay',
    label: RELAY_TITLE,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      host: { value: now.host, label: RELAY_LABELS.host, kind: 'plain' },
      port: { value: now.port, label: RELAY_LABELS.port, kind: 'plain' },
      from_address: { value: now.from_address, label: RELAY_LABELS.from_address, kind: 'plain' },
      username: { value: now.username, label: RELAY_LABELS.username, kind: 'plain' },
      starttls: { value: now.starttls, label: RELAY_LABELS.starttls, kind: 'plain' },
      password: { value: now.password, label: RELAY_LABELS.password, kind: 'secret' },
      remove_password: {
        value: now.remove_password,
        label: RELAY_LABELS.remove_password,
        kind: 'plain',
      },
    },
    save: smtpSave(tenant),
  });
  return {
    words: EMAIL_WORDS.relay,
    save,
    blocked: relayHold(save.blocked, save.dirty, save.values),
    passwordNote: passwordHint(config, save.values),
    removePassword: (remove) => {
      if (remove) save.edit('password', '');
      save.edit('remove_password', remove);
    },
  };
}
