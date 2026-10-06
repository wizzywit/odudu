import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SaveSection } from '#/features/clients/view/ClientRecordPage/SaveSection.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function save(overrides: Partial<Parameters<typeof SaveSection>[0]['save']> = {}) {
  return {
    status: 'idle' as const,
    conflicts: [],
    conflictSource: 'changed' as const,
    message: null,
    saving: false,
    keepMine: vi.fn(),
    takeTheirs: vi.fn(),
    reread: vi.fn(),
    dirty: false,
    restored: false,
    blocked: undefined,
    discard: vi.fn(),
    submit: vi.fn(() => true),
    ...overrides,
  };
}

it('is a section with the title it is given, and no save bar until it has edits', () => {
  render(
    <SaveSection title="Grant types" save={save()}>
      <p>Its fields</p>
    </SaveSection>,
  );
  expect(screen.getByRole('region', { name: 'Grant types' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Save/u })).toBeNull();
});

it('saves through the save it is given', async () => {
  const user = userEvent.setup();
  const own = save({ dirty: true });
  render(
    <SaveSection title="Grant types" save={own}>
      <p>Its fields</p>
    </SaveSection>,
  );
  await user.click(screen.getByRole('button', { name: 'Save Grant types' }));
  expect(own.submit).toHaveBeenCalled();
});

it("holds Save with the reason it is given, ahead of the save's own", () => {
  render(
    <SaveSection
      title="Grant types"
      save={save({ dirty: true, blocked: 'Its own reason.' })}
      blocked="Needs a redirect URI first."
    >
      <p>Its fields</p>
    </SaveSection>,
  );
  expect(screen.getByRole('button', { name: 'Save Grant types' })).toBeDisabled();
  expect(screen.getByText('Needs a redirect URI first.')).toBeVisible();
  expect(screen.queryByText('Its own reason.')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <SaveSection
        title="Grant types"
        description="What it may ask for."
        save={save({ dirty: true })}
      >
        <p>Its fields</p>
      </SaveSection>
    )),
  ).toEqual({ light: [], dark: [] });
});
