import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EnabledTag, OutcomeTag, StatusTag } from '#/shared/ui/StatusTag/StatusTag';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('carries its status in words, never in colour alone', () => {
  render(<StatusTag tone="danger">Disabled</StatusTag>);
  const tag = screen.getByText('Disabled');
  expect(tag).toHaveAttribute('data-tone', 'danger');
  expect(tag.textContent).toBe('Disabled');
});

it('keeps amber to a tone named for system authority', () => {
  render(<StatusTag tone="system-authority">System</StatusTag>);
  expect(screen.getByText('System')).toHaveAttribute('data-tone', 'system-authority');
});

it('defaults to the neutral tone', () => {
  render(<StatusTag>Retired</StatusTag>);
  expect(screen.getByText('Retired')).toHaveAttribute('data-tone', 'neutral');
});

it('says in words whether a record is enabled, active or danger by tone', () => {
  const { rerender } = render(<EnabledTag enabled />);
  expect(screen.getByText('enabled')).toHaveAttribute('data-tone', 'active');
  rerender(<EnabledTag enabled={false} />);
  expect(screen.getByText('disabled')).toHaveAttribute('data-tone', 'danger');
});

it('passes axe in both themes for every tone', async () => {
  const tones = ['neutral', 'active', 'warning', 'danger', 'system-authority'] as const;
  expect(
    await axeInBothThemes(() => (
      <p>
        {tones.map((tone) => (
          <StatusTag key={tone} tone={tone}>
            {tone}
          </StatusTag>
        ))}
      </p>
    )),
  ).toEqual({ light: [], dark: [] });
});

it('tones each outcome an audit event can have, in words', () => {
  const { container, rerender } = render(<OutcomeTag outcome="allowed" />);
  expect(container.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'active');
  rerender(<OutcomeTag outcome="refused" />);
  expect(container.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'warning');
  rerender(<OutcomeTag outcome="failed" />);
  expect(container.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'danger');
  expect(screen.getByText('failed')).toBeVisible();
});
