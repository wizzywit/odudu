import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

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
