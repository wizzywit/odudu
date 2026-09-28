import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useSectionDraft } from '#/shared/repository/useSectionDraft.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { TextField } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';

const RECORD = 'acme/clients/c1';
const BASE = { name: 'Billing portal', secret: '' };

// A section as a feature builds one: its own edits, the secret flagged.
function General({ onSave = vi.fn() }: { readonly onSave?: () => void }) {
  const [edits, setEdits] = useState<Partial<typeof BASE>>({});
  const dirty = Object.keys(edits).length > 0;
  const fields = Object.fromEntries(
    Object.entries(edits).map(([name, value]) => [name, { value, secret: name === 'secret' }]),
  );
  const { restored, settle } = useSectionDraft({
    record: RECORD,
    section: 'general',
    label: 'General',
    dirty,
    fields,
  });
  const [applied, setApplied] = useState(false);
  if (restored !== null && !applied) {
    setApplied(true);
    setEdits(typeof restored.name === 'string' ? { name: restored.name } : {});
  }
  const values = { ...BASE, ...edits };
  return (
    <Section
      title="General"
      dirty={dirty}
      saving={false}
      restored={restored !== null}
      onSave={onSave}
      onDiscard={() => {
        setEdits({});
        settle();
      }}
    >
      <TextField
        label="Name"
        value={values.name}
        onChange={(name) => {
          setEdits((was) => ({ ...was, name }));
        }}
      />
      <TextField
        label="Secret"
        value={values.secret}
        onChange={(secret) => {
          setEdits((was) => ({ ...was, secret }));
        }}
      />
    </Section>
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.clear();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  vi.restoreAllMocks();
  useUnsavedGuard.getState().reset();
});

it('offers its edits to be kept, leaving out the field flagged secret', async () => {
  const user = userEvent.setup();
  render(<General />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' EU');
  await user.type(screen.getByRole('textbox', { name: 'Secret' }), 'hunter2');

  expect(useDrafts.getState().keepDirty('acme/s1')).toBe(1);

  expect(useDrafts.getState().restore(RECORD, 'general')).toEqual({ name: 'Billing portal EU' });
  expect(sessionStorage.getItem('odudu.console.drafts')).not.toContain('hunter2');
  expect(useUnsavedGuard.getState().unsaved()).toEqual(['General']);
});

it('puts a kept draft back marked for review, and sends nothing', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const kept = useDrafts.getState().register({
    record: RECORD,
    section: 'general',
    dirty: () => true,
    fields: () => ({ name: { value: 'Billing portal EU' } }),
  });
  useDrafts.getState().keepDirty('acme/s1');
  kept();

  render(<General onSave={onSave} />);

  const section = screen.getByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
  expect(within(section).getByText('Unsaved changes')).toBeVisible();
  expect(useDrafts.getState().restore(RECORD, 'general')).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();

  await user.click(within(section).getByRole('button', { name: 'Discard changes to General' }));
  expect(within(section).queryByText('Restored — review before saving')).toBeNull();
});

it('keeps a restored draft through a second session end, untouched', async () => {
  const kept = useDrafts.getState().register({
    record: RECORD,
    section: 'general',
    dirty: () => true,
    fields: () => ({ name: { value: 'Billing portal EU' } }),
  });
  useDrafts.getState().keepDirty('acme/s1');
  kept();
  const first = render(<General />);
  await screen.findByText('Restored — review before saving');
  expect(useDrafts.getState().restore(RECORD, 'general')).toBeNull();

  expect(useDrafts.getState().keepDirty('acme/s1')).toBe(1);
  first.unmount();

  render(<General />);
  const section = screen.getByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
});
