import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function gate(available: boolean, tenant = 'acme') {
  return (
    <AssistantGate
      tenant={tenant}
      available={available}
      actingIn={null}
      username="ada"
      paused={false}
      renderPanel={(slot) =>
        slot.open ? (
          <aside aria-label="Assistant panel">{`panel for ${slot.tenant}`}</aside>
        ) : (
          <i data-testid="kept" />
        )
      }
    >
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

it('hands the panel what it needs when the control is pressed, and takes it away on close', async () => {
  const { wrapper: Wrapper } = harness();
  const user = userEvent.setup();
  render(<Wrapper>{gate(true)}</Wrapper>);
  await user.click(await screen.findByRole('button', { name: 'Ask the assistant' }));
  expect(screen.getByRole('complementary', { name: 'Assistant panel' })).toHaveTextContent(
    'panel for acme',
  );
  await user.click(screen.getByRole('button', { name: 'Ask the assistant' }));
  expect(screen.queryByRole('complementary')).toBeNull();
  // Closed, the panel is still there, drawing nothing, so an answer in progress goes on.
  expect(screen.getByTestId('kept')).toBeInTheDocument();
});

it('starts a tenant it is switched to closed, with nothing mounted for it', async () => {
  const { wrapper: Wrapper } = hookHarness({
    [`GET ${ACME_ADMIN}/assistant/status`]: json(ON),
    [`GET ${ACME_ADMIN.replace('acme', 'beta')}/assistant/status`]: json(ON),
  });
  const user = userEvent.setup();
  const view = render(<Wrapper>{gate(true)}</Wrapper>);
  await user.click(await screen.findByRole('button', { name: 'Ask the assistant' }));
  expect(screen.getByRole('complementary')).toHaveTextContent('panel for acme');
  view.rerender(<Wrapper>{gate(true, 'beta')}</Wrapper>);
  await screen.findByRole('button', { name: 'Ask the assistant' });
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(screen.queryByTestId('kept')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ask the assistant' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
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
