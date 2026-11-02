import type { SmtpConfig } from '@odudu/contracts/admin';

type Effective = SmtpConfig['effective'];

export function effectiveReading(effective: Effective): string {
  switch (effective) {
    case 'tenant':
      return 'This tenant sends its mail through its own relay, set below.';
    case 'deployment':
      return 'This tenant has no relay of its own, so its mail goes through the deployment’s sender.';
    case 'none':
      return 'Nothing sends this tenant’s mail: verification and reset mail is only written to the server’s log.';
  }
}

export function effectiveLabel(effective: Effective): string {
  switch (effective) {
    case 'tenant':
      return 'own relay';
    case 'deployment':
      return 'deployment sender';
    case 'none':
      return 'not sent';
  }
}

export type EffectiveTone = 'neutral' | 'active' | 'warning';

export function effectiveTone(effective: Effective): EffectiveTone {
  switch (effective) {
    case 'tenant':
      return 'active';
    case 'deployment':
      return 'neutral';
    case 'none':
      return 'warning';
  }
}
