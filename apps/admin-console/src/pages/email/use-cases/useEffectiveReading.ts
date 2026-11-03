import {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
  type EffectiveTone,
  type SmtpConfig,
} from '#/entities/mail-relay';

// Whose relay the tenant's mail goes through, as a word, a tone and a sentence.
export function useEffectiveReading(effective: SmtpConfig['effective']): {
  tone: EffectiveTone;
  label: string;
  text: string;
} {
  return {
    tone: effectiveTone(effective),
    label: effectiveLabel(effective),
    text: effectiveReading(effective),
  };
}
