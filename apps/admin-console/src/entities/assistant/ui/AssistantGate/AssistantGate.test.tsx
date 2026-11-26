import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AssistantGate } from '#/entities/assistant/ui/AssistantGate';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

afterEach(() => {
  resetConsole();
});

const ON = {
  enabled: true,
  slots: { fast: 'f', standard: 's', deep: 'd' },
  modes: ['ask'],
  defaultMode: 'ask',
  modelChoices: ['s'],
  provider: { kind: 'anthropic' },
};

function harness() {
  return hookHarness({ [`GET ${ACME_ADMIN}/assistant/status`]: json(ON) });
}

function gate(available: boolean) {
  return (
    <AssistantGate tenant="acme" available={available}>
      {({ control, panel }) => (
        <div>
          {control}
          {panel}
        </div>
      )}
    </AssistantGate>
  );
}

it('hands over nothing, and asks nothing, while the gate is shut', () => {
  const { wrapper: Wrapper, calls } = harness();
  render(<Wrapper>{gate(false)}</Wrapper>);
  expect(screen.queryByRole('button', { name: 'Ask the assistant' })).toBeNull();
  expect(calls).toEqual([]);
});

it('hands over the control once the status says the assistant is on', async () => {
  const { wrapper: Wrapper, calls } = harness();
  render(<Wrapper>{gate(true)}</Wrapper>);
  expect(await screen.findByRole('button', { name: 'Ask the assistant' })).toBeVisible();
  expect(calls.map((call) => call.path)).toEqual([`${ACME_ADMIN}/assistant/status`]);
});

it('passes axe in both themes with the control handed over', async () => {
  const { wrapper: Wrapper } = harness();
  expect(
    await axeInBothThemes(
      () => <Wrapper>{gate(true)}</Wrapper>,
      () => screen.findByRole('button', { name: 'Ask the assistant' }),
    ),
  ).toEqual({ light: [], dark: [] });
});
