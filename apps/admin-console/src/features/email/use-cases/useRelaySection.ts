import type { SmtpConfig } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { smtpSave } from '#/features/email/repository/smtpSave';
import { SMTP_RECORD } from '#/features/email/repository/useSmtpRecord';
import {
  passwordHint,
  RELAY_LABELS,
  relayHold,
  relayValues,
  type RelayValues,
} from '#/features/email/services/relay';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/services/capabilities';

export const RELAY_TITLE = 'Mail relay';

export interface RelaySection {
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
    save,
    blocked: relayHold(save.blocked, save.dirty, save.values),
    passwordNote: passwordHint(config, save.values),
    removePassword: (remove) => {
      if (remove) save.edit('password', '');
      save.edit('remove_password', remove);
    },
  };
}
