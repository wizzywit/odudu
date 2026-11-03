import { areaAt, type Area } from '#/entities/area';

const AUTHENTICATOR_TEXT: Readonly<Record<string, string>> = {
  password: "The subject's password.",
  passkey: 'A passkey registered to the subject.',
  otp: 'A one-time password from an authenticator app.',
  'recovery-code': 'One of the single-use recovery codes issued with a one-time password.',
};

export function authenticatorText(authenticator: string): string {
  return (
    AUTHENTICATOR_TEXT[authenticator] ?? 'An authenticator this console has no description of.'
  );
}

export const FLOW_RULE =
  'The steps run in this order at every sign-in. Alternatives that sit next to each other are one run: passing any of them is enough. The whole list is replaced when you save.';

export function flowArea(): { area: Area; title: string } {
  const area = areaAt('flow');
  return { area, title: area.label };
}
