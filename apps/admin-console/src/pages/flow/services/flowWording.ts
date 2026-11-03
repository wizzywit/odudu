import { areaTitled, type Area } from '#/entities/area';
import { NO_OTP_STEP, OTP_LABEL, OTP_RULE, OTP_TITLE, OTP_UNREAD } from '#/pages/flow/services/otp';
import { REQUIREMENT_OPTIONS } from '#/pages/flow/services/requirement';

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

const FLOW_RULE =
  'The steps run in this order at every sign-in. Alternatives that sit next to each other are one run: passing any of them is enough. The whole list is replaced when you save.';

export function flowArea(): { area: Area; title: string } {
  return areaTitled('flow');
}

const FLOW_WORDS = {
  description: 'What a subject is asked, in what order, to sign in to this tenant.',
  loading: 'Loading the flow',
  failed: 'The sign-in flow could not be loaded',
  unread: OTP_UNREAD,
  steps: {
    title: 'Steps',
    noticeTitle: flowArea().title,
    listLabel: 'Sign-in steps',
    rule: FLOW_RULE,
    up: 'Up',
    down: 'Down',
    requirements: REQUIREMENT_OPTIONS,
    allAdded: 'Every authenticator the server has is already a step.',
    addLabel: 'Add a step',
    addRequirementLabel: 'Requirement of the new step',
    addButton: 'Add step',
  },
  otp: { title: OTP_TITLE, rule: OTP_RULE, label: OTP_LABEL, noStep: NO_OTP_STEP },
} as const;

export type FlowWords = typeof FLOW_WORDS;

export function flowPage(): { area: Area; title: string; words: FlowWords } {
  return { ...flowArea(), words: FLOW_WORDS };
}
