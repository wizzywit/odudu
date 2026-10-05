import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDrafts, type DraftFields } from '#/shared/repository/useDrafts.ts';
import { useSectionDraft } from '#/shared/repository/useSectionDraft.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { TextField } from '#/shared/view/Field';
import { Section } from '#/shared/view/Section';

const BASE = { name: 'Billing portal', secret: '' };
const OWNER = 'system/s0';

// A section as a feature builds one: its own edits, the secret flagged, and
// a save that sends the ETag a restored draft carries in place of its own.
function General({
  tenant = 'acme',
  etag = '"e1"',
  onSave = vi.fn(),
}: {
  tenant?: string;
  etag?: string;
  onSave?: (ifMatch: string | null) => void;
}) {
  const [edits, setEdits] = useState<Partial<typeof BASE>>({});
  const dirty = Object.keys(edits).length > 0;
  const fields: DraftFields = Object.fromEntries(
    Object.entries(edits).map(([name, value]) => [
      name,
      { kind: name === 'secret' ? 'secret' : 'plain', value } as const,
    ]),
  );
  const { restored, settle } = useSectionDraft({
    tenant,
    record: 'clients/c1',
    section: 'general',
    label: 'General',
    dirty,
    fields,
    etag,
  });
  const [applied, setApplied] = useState(false);
  if (restored !== null && !applied) {
    setApplied(true);
    setEdits(typeof restored.values.name === 'string' ? { name: restored.values.name } : {});
  }
  const values = { ...BASE, ...edits };
  return (
    <Section
      title="General"
      dirty={dirty}
      saving={false}
      restored={restored !== null}
      onSave={() => {
        onSave(restored?.etag ?? etag);
      }}
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

async function keepAnEdit(tenant = 'acme'): Promise<void> {
  const user = userEvent.setup();
  const { unmount } = render(<General tenant={tenant} />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' EU');
  useDrafts.getState().keepDirty(OWNER);
  unmount();
}

it('offers its edits to be kept under its tenant, leaving out the field flagged secret', async () => {
  const user = userEvent.setup();
  render(<General />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' EU');
  await user.type(screen.getByRole('textbox', { name: 'Secret' }), 'hunter2');

  expect(useDrafts.getState().keepDirty(OWNER)).toBe(1);

  expect(useDrafts.getState().restore('acme/clients/c1', 'general')).toEqual({
    values: { name: 'Billing portal EU' },
    etag: '"e1"',
  });
  expect(sessionStorage.getItem('odudu.console.drafts')).not.toContain('hunter2');
  expect(useUnsavedGuard.getState().unsaved()).toEqual(['General']);
});

it('puts a kept draft back marked for review, and sends nothing', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  await keepAnEdit();

  render(<General onSave={onSave} />);

  const section = screen.getByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
  expect(within(section).getByText('Unsaved changes')).toBeVisible();
  expect(useDrafts.getState().restore('acme/clients/c1', 'general')).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();

  await user.click(within(section).getByRole('button', { name: 'Discard changes to General' }));
  expect(within(section).queryByText('Restored — review before saving')).toBeNull();
});

it('saves a restored edit with the ETag it was made against, not a fresh one', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  await keepAnEdit();

  render(<General etag={'"e2"'} onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Save General' }));

  expect(onSave).toHaveBeenCalledWith('"e1"');
});

it('never restores a draft kept in one tenant into another', async () => {
  await keepAnEdit('acme');

  render(<General tenant="globex" />);

  const section = screen.getByRole('region', { name: 'General' });
  expect(within(section).queryByText('Restored — review before saving')).toBeNull();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal');
  expect(useDrafts.getState().restore('acme/clients/c1', 'general')).not.toBeNull();
});

it('keeps a restored draft through a second session end, untouched', async () => {
  await keepAnEdit();
  const first = render(<General />);
  await screen.findByText('Restored — review before saving');
  expect(useDrafts.getState().restore('acme/clients/c1', 'general')).toBeNull();

  expect(useDrafts.getState().keepDirty(OWNER)).toBe(1);
  first.unmount();

  render(<General />);
  const section = screen.getByRole('region', { name: 'General' });
  expect(within(section).getByText('Restored — review before saving')).toBeVisible();
  expect(within(section).getByRole('textbox', { name: 'Name' })).toHaveValue('Billing portal EU');
});
