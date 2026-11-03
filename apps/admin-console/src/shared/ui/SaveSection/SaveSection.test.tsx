import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SaveSection } from '#/shared/ui/SaveSection';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

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

it('names the save for what it does, and the heading by the id it is given', () => {
  render(
    <SaveSection
      title="Grant types"
      saveLabel="Apply grant types"
      headingId="grants-heading"
      save={save({ dirty: true })}
    >
      <p>Its fields</p>
    </SaveSection>,
  );
  expect(screen.getByRole('button', { name: 'Apply grant types' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Grant types' })).toHaveAttribute(
    'id',
    'grants-heading',
  );
});

it('says what the last save said, under the section it belongs to', () => {
  render(
    <SaveSection
      title="Grant types"
      save={save({ status: 'refused', message: 'The gateway refused it.' })}
    >
      <p>Its fields</p>
    </SaveSection>,
  );
  expect(screen.getByRole('region', { name: 'Grant types' })).toHaveTextContent(
    'The gateway refused it.',
  );
});

it('saves through the handler it is given instead of the save, and names its notice apart', async () => {
  const user = userEvent.setup();
  const own = save({ dirty: true, status: 'stale' });
  const onSave = vi.fn();
  render(
    <SaveSection title="Steps" noticeTitle="Sign-in flow" save={own} onSave={onSave}>
      <p>Its fields</p>
    </SaveSection>,
  );
  expect(screen.getByRole('region', { name: 'Steps' })).toHaveTextContent(
    'Sign-in flow changed elsewhere',
  );
  await user.click(screen.getByRole('button', { name: 'Save Steps' }));
  expect(onSave).toHaveBeenCalled();
  expect(own.submit).not.toHaveBeenCalled();
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
