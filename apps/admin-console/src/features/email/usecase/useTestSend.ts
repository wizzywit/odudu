import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority } from '#/features/session';
import { useSmtpTest } from '#/features/email/repository/useSmtpWrites';
import {
  chosenTestClient,
  DEFAULT_TEST_CLIENT,
  testBlocked,
  testClientId,
  testClientSelection,
  testClientsClosed,
  testClientsRead,
  testClientSummary,
  testOutcome,
  testSendable,
  type TestClientChoice,
  type TestOutcome,
} from '#/features/email/service';
import { useClientPicker } from '#/shared/repository/useClientPicker';
import type { PickerState } from '#/shared/service/picker';

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
