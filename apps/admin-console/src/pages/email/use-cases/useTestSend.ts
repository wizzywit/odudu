import type { Client } from '#/entities/client';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { useSmtpTest } from '#/pages/email/repository/useSmtpWrites';
import { EMAIL_WORDS, testRule, type EmailWords } from '#/pages/email/services/emailWords';
import {
  testBlocked,
  testOutcome,
  testSendable,
  type TestOutcome,
} from '#/pages/email/services/testSend';
import {
  chosenTestClient,
  DEFAULT_TEST_CLIENT,
  testClientId,
  testClientSelection,
  testClientsClosed,
  testClientsRead,
  testClientSummary,
  type TestClientChoice,
} from '#/pages/email/services/testClient';
import { useClientPicker } from '#/entities/client';
import type { PickerState } from '#/shared/lib/services/picker';

export interface TestForm {
  to: string;
  setTo: (to: string) => void;
  busy: boolean;
  // Why the test cannot be sent now, or nothing.
  blocked: string | undefined;
  send: () => void;
}

export interface TestClient {
  picker: PickerState<Client>;
  // Whoami says the operator may not choose a client, so the choice is not drawn.
  closed: boolean;
  // The ids the picker shows chosen: the client sent as, or none for the tenant's own look.
  selected: string[];
  choose: (ids: readonly string[]) => void;
  useTenantOwn: () => void;
  summary: string;
}

export interface TestSend {
  words: EmailWords['test'];
  // What the panel says it does, and that edits above are not used.
  rule: string;
  form: TestForm;
  outcome: TestOutcome | null;
  client: TestClient;
}

export function useTestSend(tenant: string, configured: boolean, unsaved: boolean): TestSend {
  const test = useSmtpTest(tenant);
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [choice, setChoice] = useState<TestClientChoice>(DEFAULT_TEST_CLIENT);
  const authority = useAuthority(tenant);
  const picker = useClientPicker(tenant, testClientsRead(authority));
  const clientId = testClientId(choice, picker.status, picker.options);
  const blocked = testBlocked(to, configured);
  return {
    words: EMAIL_WORDS.test,
    rule: testRule(unsaved),
    form: {
      to,
      setTo,
      busy: test.busy,
      blocked,
      send: () => {
        if (!testSendable(test.busy, blocked)) return;
        const target = to.trim();
        setOutcome(null);
        test
          .run({ to: target, clientId })
          .then((result) => {
            setOutcome(testOutcome(result, target));
          })
          .catch(() => {
            setOutcome(testOutcome({ ok: false, kind: 'defect' }, target));
          });
      },
    },
    outcome,
    client: {
      picker,
      closed: testClientsClosed(authority),
      selected: testClientSelection(clientId),
      choose: (ids) => {
        setChoice(chosenTestClient(ids));
      },
      useTenantOwn: () => {
        setChoice({ kind: 'tenant' });
      },
      summary: testClientSummary(clientId, picker.options),
    },
  };
}
