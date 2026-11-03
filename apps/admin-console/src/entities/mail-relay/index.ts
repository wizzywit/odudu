export type { SmtpConfig } from '#/entities/mail-relay/types/mailRelay';
export { readSmtp } from '#/entities/mail-relay/use-cases/relayCalls';
export {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
  hasRelay,
  type EffectiveTone,
} from '#/entities/mail-relay/services/effective';
