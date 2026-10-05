import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote/ViewOnlyNote.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

describe('ViewOnlyNote', () => {
  it('says in one line what may be looked at, and what changing it needs', () => {
    render(<ViewOnlyNote noun="subjects" needs={['manage-users']} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'You can view subjects but not change them (needs manage-users).',
    );
  });

  it('names every capability a change needs', () => {
    render(<ViewOnlyNote noun="tenants" needs={['manage-tenant', 'manage-clients']} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'You can view tenants but not change them (needs manage-tenant and manage-clients).',
    );
  });

  it('names what cannot be done, when some of a page can be changed', () => {
    render(
      <ViewOnlyNote
        noun="system administrators"
        change="create them, or grant or revoke tenant-admin"
        needs={['manage-users']}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'You can view system administrators but not create them, or grant or revoke tenant-admin (needs manage-users).',
    );
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => <ViewOnlyNote noun="subjects" needs={['manage-users']} />),
    ).toEqual({ light: [], dark: [] });
  });
});
