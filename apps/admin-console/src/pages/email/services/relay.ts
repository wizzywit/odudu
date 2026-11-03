import { smtpPortSchema, type PutSmtpRequest, type SmtpConfig } from '@odudu/contracts/admin';

export interface RelayValues extends Readonly<Record<string, unknown>> {
  host: string;
  port: string;
  from_address: string;
  username: string;
  starttls: boolean;
  // Typed to replace the stored one; never read from the server.
  password: string;
  // Clears the stored one.
  remove_password: boolean;
}

export const RELAY_LABELS = {
  host: 'Host',
  port: 'Port',
  from_address: 'Sender address',
  username: 'Username',
  starttls: 'Require TLS (STARTTLS)',
  password: 'New password',
  remove_password: 'Remove the stored password',
} as const;

const SUBMISSION_PORT = '587';

export function relayValues(config: SmtpConfig): RelayValues {
  return {
    host: config.host ?? '',
    port: config.port === null ? SUBMISSION_PORT : String(config.port),
    from_address: config.from_address ?? '',
    username: config.username ?? '',
    starttls: config.starttls ?? true,
    password: '',
    remove_password: false,
  };
}

// The password is left out to keep the stored one, sent to replace it, and
// sent as null to clear it.
export function relayRequest(values: RelayValues): PutSmtpRequest {
  const username = values.username.trim();
  const request: PutSmtpRequest = {
    host: values.host.trim(),
    port: Number(values.port),
    from_address: values.from_address.trim(),
    username: username === '' ? null : username,
    starttls: values.starttls,
  };
  if (values.remove_password) return { ...request, password: null };
  return values.password === '' ? request : { ...request, password: values.password };
}

export const PORT_RULE = 'A whole number from 1 to 65535.';

// Why Save is held: a value the server would refuse in a way that names no field.
export function relayBlocked(values: RelayValues): string | undefined {
  if (values.host.trim() === '') return 'Enter the relay host.';
  if (values.from_address.trim() === '') return 'Enter the sender address.';
  if (!/^\d+$/u.test(values.port) || !smtpPortSchema.safeParse(Number(values.port)).success) {
    return `The port is not valid. ${PORT_RULE}`;
  }
  return undefined;
}

// What holds Save: the section's own reason, or an unfinished relay once edited.
export function relayHold(
  held: string | undefined,
  dirty: boolean,
  values: RelayValues,
): string | undefined {
  return held ?? (dirty ? relayBlocked(values) : undefined);
}

function relayMoved(config: SmtpConfig, values: RelayValues): boolean {
  const username = values.username.trim();
  return (
    values.host.trim() !== (config.host ?? '') ||
    values.port !== String(config.port ?? '') ||
    (username === '' ? null : username) !== config.username
  );
}

export function passwordHint(config: SmtpConfig, values: RelayValues): string {
  if (!config.password_set) return 'Leave it empty if the relay needs none.';
  if (values.password === '' && !values.remove_password && relayMoved(config, values)) {
    return 'The stored password is only kept for the host, port and username it was set for. Enter it again, or remove it.';
  }
  return 'A password is stored and never shown. Leave this empty to keep it.';
}
