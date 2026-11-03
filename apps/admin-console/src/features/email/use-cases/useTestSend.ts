import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { useSmtpTest } from '#/features/email/repository/useSmtpWrites';
import {
  testBlocked,
  testOutcome,
  testSendable,
  type TestOutcome,
} from '#/features/email/services/testSend';
import {
  chosenTestClient,
  DEFAULT_TEST_CLIENT,
  testClientId,
  testClientSelection,
  testClientsClosed,
  testClientsRead,
  testClientSummary,
  type TestClientChoice,
} from '#/features/email/services/testClient';
import { useClientPicker } from '#/entities/client';
import type { PickerState } from '#/shared/services/picker';

export interface TestSend {
  to: string;
  setTo: (to: string) => void;
  busy: boolean;
  // Why the test cannot be sent now, or nothing.
  blocked: string | undefined;
  outcome: TestOutcome | null;
  send: () => void;
  picker: PickerState<Client>;
  // Whoami says the operator may not choose a client, so the choice is not drawn.
  clientsClosed: boolean;
  // The ids the picker shows chosen: the client sent as, or none for the tenant's own look.
  selected: string[];
  choose: (ids: readonly string[]) => void;
  useTenantOwn: () => void;
  summary: string;
}

export function useTestSend(tenant: string, configured: boolean): TestSend {
  const test = useSmtpTest(tenant);
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [choice, setChoice] = useState<TestClientChoice>(DEFAULT_TEST_CLIENT);
  const authority = useAuthority(tenant);
  const picker = useClientPicker(tenant, testClientsRead(authority));
  const clientId = testClientId(choice, picker.status, picker.options);
  const blocked = testBlocked(to, configured);
  return {
    to,
    setTo,
    busy: test.busy,
    blocked,
    outcome,
    picker,
    clientsClosed: testClientsClosed(authority),
    selected: testClientSelection(clientId),
    choose: (ids) => {
      setChoice(chosenTestClient(ids));
    },
    useTenantOwn: () => {
      setChoice({ kind: 'tenant' });
    },
    summary: testClientSummary(clientId, picker.options),
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
  };
}
