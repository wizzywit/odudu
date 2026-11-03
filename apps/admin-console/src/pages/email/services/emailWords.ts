import { areaTitled, type Area } from '#/entities/area';
import { PORT_RULE, RELAY_LABELS } from '#/pages/email/services/relay';
import { removeConsequence } from '#/pages/email/services/remove';
import { TEST_AS_LABEL, TEST_AS_RULE, TEST_TENANT_OWN } from '#/pages/email/services/testClient';

// The section's own name: its save button, its draft and its conflict panel say it.
export const RELAY_TITLE = 'Mail relay';

export const EMAIL_WORDS = {
  description: "The relay this tenant's verification and reset mail goes through.",
  loading: 'Loading the mail relay',
  failed: 'The mail relay could not be loaded',
  relay: {
    title: RELAY_TITLE,
    description:
      "The server this tenant's verification and reset mail is sent through. Saving replaces the whole relay.",
    labels: RELAY_LABELS,
    portRule: PORT_RULE,
    fromNote: 'What the From line of each message says.',
    usernameNote: 'Leave it empty if the relay needs no login.',
    starttlsNote:
      'Required while a username or password is set, so they are not sent in the clear.',
  },
  test: {
    title: 'Test message',
    to: 'Send to',
    submit: 'Send test message',
    sending: 'Sending…',
    clientsNeeded: 'Choosing clients',
    clientLabel: TEST_AS_LABEL,
    clientRule: TEST_AS_RULE,
    tenantOwn: TEST_TENANT_OWN,
  },
  remove: {
    title: 'Remove the relay',
    rule: 'Goes back to the deployment’s sender, if it has one.',
    action: 'Remove the relay',
    dialogTitle: 'Remove this tenant’s relay?',
    consequence: removeConsequence(),
  },
} as const;

export type EmailWords = typeof EMAIL_WORDS;

const TEST_RULE = 'Sends one message through the saved relay and tells what the server answered.';
const TEST_UNSAVED = 'The test uses the saved relay, not the changes above.';

export function testRule(unsaved: boolean): string {
  return unsaved ? `${TEST_RULE} ${TEST_UNSAVED}` : TEST_RULE;
}

export function emailArea(): { area: Area; title: string } {
  return areaTitled('email');
}
