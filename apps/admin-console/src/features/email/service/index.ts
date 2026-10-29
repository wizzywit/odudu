export {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
} from '#/features/email/service/effective';
export {
  ALREADY_NONE,
  removeConsequence,
  removeOutcome,
  REMOVED_TEXT,
} from '#/features/email/service/remove';
export {
  passwordHint,
  PORT_RULE,
  RELAY_LABELS,
  relayBlocked,
  relayHold,
  relayRequest,
  relayValues,
  type RelayValues,
} from '#/features/email/service/relay';
export { testBlocked, testOutcome, type TestOutcome } from '#/features/email/service/test';
export {
  anyMasked,
  mailOutcome,
  mailQuery,
  mailTone,
  MAIL_HEADING,
  MAIL_RULE,
  MAIL_STATUS_OPTIONS,
  MASKED_NOTE,
  NO_MAIL,
  oldestWaiting,
  type MailOutcome,
} from '#/features/email/service/mail';
export {
  chosenTestClient,
  DEFAULT_TEST_CLIENT,
  TEST_AS_LABEL,
  TEST_AS_RULE,
  TEST_TENANT_OWN,
  testClientId,
  testClientsClosed,
  testClientsRead,
  testClientSelection,
  testClientSummary,
  type TestClientChoice,
} from '#/features/email/service/testClient';
